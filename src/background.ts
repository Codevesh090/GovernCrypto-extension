// Background service worker

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId })
  }
})

// Listen for wallet connection from content script (walletBridge.ts)
chrome.runtime.onMessage.addListener((msg, sender, _sendResponse) => {
  console.log('[Background] Message received:', msg?.type, 'from:', sender?.url)

  if (msg.type === 'WALLET_CONNECTED' && msg.payload?.address) {
    const address = msg.payload.address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      console.log('[Background] Invalid address rejected:', address)
      return
    }
    console.log('[Background] Saving address to storage:', address)
    chrome.storage.local.set({ connectedAddress: address }, () => {
      console.log('[Background] Address saved successfully')
    })
  }
})
