import type { ApiClient } from '../services/api'
import type { MaskedKeys } from '../types'

type ShowToast = (message: string, isError?: boolean) => void

function maskPlaceholder(masked: string | null): string {
  if (!masked) return ''
  return masked  // server already returns e.g. "****xyz"
}

async function loadMaskedKeys(api: ApiClient): Promise<void> {
  const inputs = {
    elevenlabs: document.getElementById('key-elevenlabs') as HTMLInputElement,
    awsAccess:  document.getElementById('key-aws-access')  as HTMLInputElement,
    awsSecret:  document.getElementById('key-aws-secret')  as HTMLInputElement,
    awsRegion:  document.getElementById('key-aws-region')  as HTMLInputElement,
  }

  try {
    const masked: MaskedKeys = await api.getKeys()
    inputs.elevenlabs.placeholder = maskPlaceholder(masked.elevenlabsKey)    || 'Not set'
    inputs.awsAccess.placeholder  = maskPlaceholder(masked.awsAccessKeyId)  || 'Not set'
    inputs.awsSecret.placeholder  = maskPlaceholder(masked.awsSecretAccessKey) || 'Not set'
    inputs.awsRegion.placeholder  = masked.awsRegion ?? 'Not set'
  } catch {
    // silently ignore — placeholders stay empty
  }
}

export function initKeys(api: ApiClient, showToast: ShowToast): void {
  const saveBtn = document.getElementById('keys-save-btn') as HTMLButtonElement

  const inputs = {
    elevenlabs: document.getElementById('key-elevenlabs') as HTMLInputElement,
    awsAccess:  document.getElementById('key-aws-access')  as HTMLInputElement,
    awsSecret:  document.getElementById('key-aws-secret')  as HTMLInputElement,
    awsRegion:  document.getElementById('key-aws-region')  as HTMLInputElement,
  }

  // Load masked placeholders on init
  void loadMaskedKeys(api)

  saveBtn.addEventListener('click', async () => {
    const elevenlabs = inputs.elevenlabs.value.trim()
    const awsAccess  = inputs.awsAccess.value.trim()
    const awsSecret  = inputs.awsSecret.value.trim()
    const awsRegion  = inputs.awsRegion.value.trim()

    if (!elevenlabs || !awsAccess || !awsSecret || !awsRegion) {
      showToast('All four fields are required.', true)
      return
    }

    saveBtn.disabled = true

    try {
      await api.saveKeys({
        elevenlabsKey:       elevenlabs,
        awsAccessKeyId:      awsAccess,
        awsSecretAccessKey:  awsSecret,
        awsRegion:           awsRegion,
      })

      // Clear fields
      inputs.elevenlabs.value = ''
      inputs.awsAccess.value  = ''
      inputs.awsSecret.value  = ''
      inputs.awsRegion.value  = ''

      showToast('Keys saved.')
      // Notify glasses UI that keys changed
      window.dispatchEvent(new CustomEvent('notewriter:keys-changed'))
      // Refresh masked placeholders
      await loadMaskedKeys(api)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save keys.', true)
    } finally {
      saveBtn.disabled = false
    }
  })
}
