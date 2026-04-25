/**
 * Content script — injected at document_start on governcrypto.xyz
 * Polls localStorage for wallet data and sends to extension via chrome.runtime.sendMessage
 * This is the PRIMARY channel — no window.opener, no postMessage
 */

const STORAGE_KEY = 'governcrypto_wallet'
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

let sent = false

function checkWalletData(): void {
  if (sent) return

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw)
    const { address, timestamp } = parsed

    // Validate address format
    if (!address || !ETH_ADDRESS_REGEX.test(address)) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }

    // Only process recent connections (within 30 seconds)
    if (!timestamp || Date.now() - timestamp > 30000) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }

    sent = true

    // Send to extension background/popup
    chrome.runtime.sendMessage({
      type: 'WALLET_CONNECTED',
      payload: { address, timestamp }
    })

    // Clean up localStorage
    localStorage.removeItem(STORAGE_KEY)

    // Close the tab after success
    setTimeout(() => window.close(), 500)

  } catch (e) {
    // ignore parse errors
  }
}

// Poll every 500ms
const interval = setInterval(checkWalletData, 500)

// Stop polling after 5 minutes
setTimeout(() => clearInterval(interval), 300000)
