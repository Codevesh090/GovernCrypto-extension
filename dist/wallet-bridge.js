"use strict";
(() => {
  // src/walletBridge.ts
  var STORAGE_KEY = "governcrypto_wallet";
  var ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
  var sent = false;
  function checkWalletData() {
    if (sent) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const { address, timestamp } = parsed;
      if (!address || !ETH_ADDRESS_REGEX.test(address)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (!timestamp || Date.now() - timestamp > 3e4) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      sent = true;
      console.log("[Bridge] Found wallet data:", address);
      chrome.storage.local.set({ connectedAddress: address }, () => {
        if (chrome.runtime.lastError) {
          console.log("[Bridge] storage.set error:", chrome.runtime.lastError.message);
        } else {
          console.log("[Bridge] Written to chrome.storage.local successfully");
        }
      });
      try {
        chrome.runtime.sendMessage(
          { type: "WALLET_CONNECTED", payload: { address, timestamp } },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch (_) {
      }
      localStorage.removeItem(STORAGE_KEY);
      setTimeout(() => window.close(), 800);
    } catch (e) {
      console.log("[Bridge] Error:", e);
    }
  }
  console.log("[Bridge] Content script loaded on:", window.location.href);
  var interval = setInterval(checkWalletData, 500);
  setTimeout(() => clearInterval(interval), 3e5);
})();
