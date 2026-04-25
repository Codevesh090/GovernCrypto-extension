"use strict";
(() => {
  // src/background.ts
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== void 0) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.type === "WALLET_CONNECTED" && msg.payload?.address) {
      const address = msg.payload.address;
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;
      chrome.storage.local.set({ connectedAddress: address });
    }
  });
})();
