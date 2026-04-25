// Background service worker

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId })
  }
})

// Listen for wallet connection from content script (walletBridge.ts)
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg.type === 'WALLET_CONNECTED' && msg.payload?.address) {
    const address = msg.payload.address
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return
    // Save to chrome.storage — popup listens for this change
    chrome.storage.local.set({ connectedAddress: address })
  }
})
