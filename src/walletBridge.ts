/**
 * Content script injected into governcrypto.xyz/connect and /sign
 * Watches for wallet connection and bridges to chrome.storage
 */

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

let lastCheckedTs = ''

function isValidAddress(address: string): boolean {
  return ETH_ADDRESS_REGEX.test(address)
}

function checkAndBridge(): void {
  try {
    const address = localStorage.getItem('gc_wallet_address')
    const ts = localStorage.getItem('gc_wallet_ts')

    if (!address || !ts || ts === lastCheckedTs) return

    // Validate address format before storing
    if (!isValidAddress(address)) {
      localStorage.removeItem('gc_wallet_address')
      localStorage.removeItem('gc_wallet_ts')
      return
    }

    // Only process recent connections (within last 30 seconds)
    const age = Date.now() - parseInt(ts)
    if (age > 30000) {
      localStorage.removeItem('gc_wallet_address')
      localStorage.removeItem('gc_wallet_ts')
      return
    }

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

// Listen for custom events dispatched by the page
window.addEventListener('gc_wallet_connected', (e: any) => {
  const address = e.detail?.address
  if (address && isValidAddress(address)) {
    chrome.storage.local.set({ connectedAddress: address })
  }
})

// Poll every 300ms, stop after 2 minutes
const interval = setInterval(checkAndBridge, 300)
setTimeout(() => clearInterval(interval), 120000)
