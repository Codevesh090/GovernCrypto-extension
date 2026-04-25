/**
 * Content script — injected on governcrypto.xyz
 * Polls localStorage and writes directly to chrome.storage.local
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

    if (!address || !ETH_ADDRESS_REGEX.test(address)) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }

    if (!timestamp || Date.now() - timestamp > 30000) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }

    sent = true

    chrome.storage.local.set({ connectedAddress: address }, () => {
      if (chrome.runtime.lastError) { /* silent */ }
    })

    try {
      chrome.runtime.sendMessage(
        { type: 'WALLET_CONNECTED', payload: { address, timestamp } },
        () => { void chrome.runtime.lastError }
      )
    } catch (_) {}

    localStorage.removeItem(STORAGE_KEY)
    setTimeout(() => window.close(), 800)

  } catch (_) {}
}

const interval = setInterval(checkWalletData, 500)
setTimeout(() => clearInterval(interval), 300000)
