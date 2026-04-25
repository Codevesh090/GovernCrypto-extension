/**
 * Content script — injected on governcrypto.xyz
 * Polls localStorage and writes directly to chrome.storage.local
 * Also sends runtime message as secondary channel
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
    console.log('[Bridge] Found wallet data:', address)

    // PRIMARY: Write directly to chrome.storage.local
    chrome.storage.local.set({ connectedAddress: address }, () => {
      if (chrome.runtime.lastError) {
        console.log('[Bridge] storage.set error:', chrome.runtime.lastError.message)
      } else {
        console.log('[Bridge] Written to chrome.storage.local successfully')
      }
    })

    // SECONDARY: Also send runtime message (wakes up background if needed)
    try {
      chrome.runtime.sendMessage(
        { type: 'WALLET_CONNECTED', payload: { address, timestamp } },
        () => { void chrome.runtime.lastError }
      )
    } catch (_) {}

    // Clean up localStorage
    localStorage.removeItem(STORAGE_KEY)

    // Close tab after storage write
    setTimeout(() => window.close(), 800)

  } catch (e) {
    console.log('[Bridge] Error:', e)
  }
}

console.log('[Bridge] Content script loaded on:', window.location.href)

// Poll every 500ms
const interval = setInterval(checkWalletData, 500)
setTimeout(() => clearInterval(interval), 300000)
