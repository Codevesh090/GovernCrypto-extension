/**
 * Content script — injected at document_start on governcrypto.xyz
 * Polls localStorage for wallet data and sends to extension via chrome.runtime.sendMessage
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
    console.log('[Bridge] Found wallet, sending to extension:', address)

    chrome.runtime.sendMessage(
      { type: 'WALLET_CONNECTED', payload: { address, timestamp } },
      (_response) => {
        if (chrome.runtime.lastError) {
          console.log('[Bridge] sendMessage error:', chrome.runtime.lastError.message)
          // Fallback: write directly to storage if sendMessage fails
          chrome.storage.local.set({ connectedAddress: address })
        } else {
          console.log('[Bridge] Message delivered to extension')
        }
      }
    )

    localStorage.removeItem(STORAGE_KEY)
    setTimeout(() => window.close(), 800)

  } catch (e) {
    console.log('[Bridge] Error:', e)
  }
}

// Poll every 500ms
const interval = setInterval(checkWalletData, 500)
setTimeout(() => clearInterval(interval), 300000)
