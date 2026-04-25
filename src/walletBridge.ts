/**
 * Content script injected into governcrypto.xyz/connect and /sign
 * Watches for wallet connection and bridges to chrome.storage
 */

let lastCheckedTs = ''

function checkAndBridge(): void {
  try {
    const address = localStorage.getItem('gc_wallet_address')
    const ts = localStorage.getItem('gc_wallet_ts')

    if (!address || !ts || ts === lastCheckedTs) return

    // Only process recent connections (within last 60 seconds)
    const age = Date.now() - parseInt(ts)
    if (age > 60000) return

    lastCheckedTs = ts

    // Write directly to chrome.storage from content script context
    chrome.storage.local.set({ connectedAddress: address }, () => {
      localStorage.removeItem('gc_wallet_address')
      localStorage.removeItem('gc_wallet_ts')
    })
  } catch (e) {
    // ignore
  }
}

// Also listen for custom events dispatched by the page
window.addEventListener('gc_wallet_connected', (e: any) => {
  const address = e.detail?.address
  if (address) {
    chrome.storage.local.set({ connectedAddress: address })
  }
})

// Poll every 300ms
const interval = setInterval(checkAndBridge, 300)
setTimeout(() => clearInterval(interval), 300000)
