import type { ApiClient } from '../services/api'

type ShowToast = (message: string, isError?: boolean) => void

interface KeyField {
  input: HTMLInputElement
  statusEl: HTMLElement
  maskedValue: string
  fullValue: string   // stored after user saves, cleared on reload
  isEditing: boolean
  isRevealed: boolean
}

export function initKeys(api: ApiClient, showToast: ShowToast): void {
  const saveBtn = document.getElementById('keys-save-btn') as HTMLButtonElement

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
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false,
    },
    openai: {
      input: document.getElementById('key-openai') as HTMLInputElement,
      statusEl: document.getElementById('status-openai') as HTMLElement,
      maskedValue: '', fullValue: '', isEditing: false, isRevealed: false,
    },
  }

  function renderField(field: KeyField): void {
    if (field.isEditing) return
    if (field.isRevealed && field.fullValue) {
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

  // Load masked keys on init
  async function loadMasked(): Promise<void> {
    try {
      const masked = await api.getKeys()
      showMasked(fields.elevenlabs, masked.elevenlabsKey)
      showMasked(fields.awsAccess, masked.awsAccessKeyId)
      showMasked(fields.awsSecret, masked.awsSecretAccessKey)
      showMasked(fields.awsRegion, masked.awsRegion)
      showMasked(fields.openai, masked.openaiKey)
    } catch {
      // Not configured yet
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

    // For first save, all four core fields required. OpenAI is optional.
    const hasExisting = fields.elevenlabs.maskedValue !== ''
    if (!hasExisting && (!el || !aa || !as_ || !ar)) {
      showToast('All four fields are required for first setup.', true)
      return
    }

    const edited = [el, aa, as_, ar, oa].some(v => v !== '')
    if (!edited) {
      showToast('No changes to save.', true)
      return
    }

    // Build payload — only include edited fields, keep existing for others
    // Worker requires all core fields, so we need to get current values for non-edited fields
    // Actually, simplify: require all four core fields if any is being provided
    if (el && aa && as_ && ar) {
      // Full save
      saveBtn.disabled = true
      try {
        await api.saveKeys({
          elevenlabsKey: el,
          awsAccessKeyId: aa,
          awsSecretAccessKey: as_,
          awsRegion: ar,
          openaiKey: oa,
        })
        // Store full values for eye-reveal, reset editing state
        fields.elevenlabs.fullValue = el
        fields.awsAccess.fullValue = aa
        fields.awsSecret.fullValue = as_
        fields.awsRegion.fullValue = ar
        fields.openai.fullValue = oa
        for (const field of Object.values(fields)) {
          field.isEditing = false
          field.isRevealed = false
        }
        showToast('Keys saved.')
        window.dispatchEvent(new CustomEvent('notewriter:keys-changed'))
        await loadMasked()
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to save keys.', true)
      } finally {
        saveBtn.disabled = false
      }
    } else {
      showToast('Please fill all four fields to update keys.', true)
    }
  })
}
