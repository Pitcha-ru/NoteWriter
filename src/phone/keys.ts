import type { ApiClient } from '../services/api'
import type { TranslateProvider } from '../types'

type ShowToast = (message: string, isError?: boolean) => void

interface KeyField {
  input: HTMLInputElement
  statusEl: HTMLElement
  maskedValue: string
  fullValue: string   // stored after user saves, cleared on reload
  isEditing: boolean
  isRevealed: boolean
  plainText?: boolean // if true, don't mask the field
}

export function initKeys(api: ApiClient, showToast: ShowToast): void {
  const saveBtn = document.getElementById('keys-save-btn') as HTMLButtonElement
  const providerSelect = document.getElementById('keys-translate-provider') as HTMLSelectElement
  const modelSelect = document.getElementById('keys-translate-model') as HTMLSelectElement
  const modelField = document.getElementById('keys-translate-model-field') as HTMLDivElement
  const awsCard = document.getElementById('keys-aws-card') as HTMLDivElement

  // Show/hide AWS card and model field based on provider
  function onProviderChange(): void {
    const isOpenai = providerSelect.value === 'openai'
    awsCard.style.display = isOpenai ? 'none' : 'block'
    modelField.style.display = isOpenai ? 'block' : 'none'
  }

  // Auto-save provider/model when changed
  async function saveProviderSettings(): Promise<void> {
    const translateProvider = providerSelect.value as TranslateProvider
    const translateModel = modelSelect.value
    try {
      await api.saveSettings({ translateProvider, translateModel })
      window.dispatchEvent(new CustomEvent('notewriter:settings-changed', { detail: { translateProvider, translateModel } }))
      window.dispatchEvent(new CustomEvent('notewriter:keys-changed'))
    } catch {}
  }

  providerSelect.addEventListener('change', () => { onProviderChange(); saveProviderSettings() })
  modelSelect.addEventListener('change', () => { saveProviderSettings() })

  const fields: Record<string, KeyField> = {
    elevenlabs: {
      input: document.getElementById('key-elevenlabs') as HTMLInputElement,
      statusEl: document.getElementById('status-elevenlabs') as HTMLElement,
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false,
    },
    awsAccess: {
      input: document.getElementById('key-aws-access') as HTMLInputElement,
      statusEl: document.getElementById('status-aws-access') as HTMLElement,
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false,
    },
    awsSecret: {
      input: document.getElementById('key-aws-secret') as HTMLInputElement,
      statusEl: document.getElementById('status-aws-secret') as HTMLElement,
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false,
    },
    awsRegion: {
      input: document.getElementById('key-aws-region') as HTMLInputElement,
      statusEl: document.getElementById('status-aws-region') as HTMLElement,
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false, plainText: true,
    },
    openai: {
      input: document.getElementById('key-openai') as HTMLInputElement,
      statusEl: document.getElementById('status-openai') as HTMLElement,
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false,
    },
  }

  function renderField(field: KeyField): void {
    if (field.isEditing) return
    if (field.plainText) {
      field.input.value = field.maskedValue || field.input.value
      field.input.type = 'text'
    } else if (field.isRevealed && field.fullValue) {
      field.input.value = field.fullValue
      field.input.type = 'text'
    } else {
      field.input.value = field.maskedValue
      field.input.type = 'password'
    }
    if (field.maskedValue) {
      field.statusEl.textContent = 'Saved'
      field.statusEl.className = 'key-status saved'
    } else {
      field.statusEl.textContent = 'Not configured'
      field.statusEl.className = 'key-status'
    }
  }

  function showMasked(field: KeyField, masked: string | null): void {
    field.maskedValue = masked ?? ''
    if (!field.isEditing) renderField(field)
  }

  // When user focuses a field, clear it for editing
  for (const field of Object.values(fields)) {
    field.input.addEventListener('focus', () => {
      if (!field.isEditing) {
        field.isEditing = true
        field.input.value = ''
        field.input.type = 'text'
        field.statusEl.textContent = 'Enter new value'
        field.statusEl.className = 'key-status'
      }
    })

    field.input.addEventListener('blur', () => {
      if (field.isEditing && field.input.value.trim() === '') {
        field.isEditing = false
        renderField(field)
      }
    })
  }

  // Eye toggle buttons — reveal full key (only available if saved this session)
  const fieldByInputId: Record<string, KeyField> = {
    'key-elevenlabs': fields.elevenlabs,
    'key-aws-access': fields.awsAccess,
    'key-aws-secret': fields.awsSecret,
    'key-aws-region': fields.awsRegion,
    'key-openai': fields.openai,
  }

  document.querySelectorAll<HTMLButtonElement>('.eye-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      const targetId = btn.dataset['target']
      if (!targetId) return
      const field = fieldByInputId[targetId]
      if (!field || field.isEditing) return

      if (!field.fullValue) {
        showToast('Full key only visible after entering it this session.', true)
        return
      }

      field.isRevealed = !field.isRevealed
      btn.textContent = field.isRevealed ? '\u25C9' : '\u25CE'
      renderField(field)
    })
  })

  // Load masked keys and translation settings on init
  async function loadMasked(): Promise<void> {
    try {
      const [masked, settings] = await Promise.all([api.getKeys(), api.getSettings()])
      showMasked(fields.elevenlabs, masked.elevenlabsKey)
      showMasked(fields.awsAccess, masked.awsAccessKeyId)
      showMasked(fields.awsSecret, masked.awsSecretAccessKey)
      showMasked(fields.awsRegion, masked.awsRegion)
      showMasked(fields.openai, masked.openaiKey)
      providerSelect.value = settings.translateProvider ?? 'amazon'
      modelSelect.value = settings.translateModel ?? 'gpt-4o-mini'
      onProviderChange()
    } catch {
      // Not configured yet
      onProviderChange()
    }
  }

  void loadMasked()

  // Save handler
  saveBtn.addEventListener('click', async () => {
    // Collect only fields that were actually edited
    const el = fields.elevenlabs.isEditing ? fields.elevenlabs.input.value.trim() : ''
    const aa = fields.awsAccess.isEditing ? fields.awsAccess.input.value.trim() : ''
    const as_ = fields.awsSecret.isEditing ? fields.awsSecret.input.value.trim() : ''
    const ar = fields.awsRegion.isEditing ? fields.awsRegion.input.value.trim() : ''
    const oa = fields.openai.isEditing ? fields.openai.input.value.trim() : ''

    const edited = [el, aa, as_, ar, oa].some(v => v !== '')
    if (!edited) {
      showToast('No changes to save.', true)
      return
    }

    // Send only edited fields — Worker merges with existing
    saveBtn.disabled = true
    try {
      await api.saveKeys({
        elevenlabsKey: el,
        awsAccessKeyId: aa,
        awsSecretAccessKey: as_,
        awsRegion: ar,
        openaiKey: oa,
      })
      // Store full values for eye-reveal
      if (el) fields.elevenlabs.fullValue = el
      if (aa) fields.awsAccess.fullValue = aa
      if (as_) fields.awsSecret.fullValue = as_
      if (ar) fields.awsRegion.fullValue = ar
      if (oa) fields.openai.fullValue = oa
      for (const field of Object.values(fields)) {
        field.isEditing = false
        field.isRevealed = false
      }
      // Save translation provider/model to settings
      const translateProvider = providerSelect.value as TranslateProvider
      const translateModel = modelSelect.value
      try {
        const currentSettings = await api.getSettings()
        await api.saveSettings({ ...currentSettings, translateProvider, translateModel })
        window.dispatchEvent(new CustomEvent('notewriter:settings-changed', { detail: { ...currentSettings, translateProvider, translateModel } }))
      } catch {}
      showToast('Keys saved.')
      window.dispatchEvent(new CustomEvent('notewriter:keys-changed'))
      await loadMasked()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save keys.', true)
    } finally {
      saveBtn.disabled = false
    }
  })
}
