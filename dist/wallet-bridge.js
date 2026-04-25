"use strict";
(() => {
  // src/walletBridge.ts
  var lastCheckedTs = "";
  function checkAndBridge() {
    try {
      const address = localStorage.getItem("gc_wallet_address");
      const ts = localStorage.getItem("gc_wallet_ts");
      if (!address || !ts || ts === lastCheckedTs) return;
      const age = Date.now() - parseInt(ts);
      if (age > 6e4) return;
      lastCheckedTs = ts;
      chrome.storage.local.set({ connectedAddress: address }, () => {
        localStorage.removeItem("gc_wallet_address");
        localStorage.removeItem("gc_wallet_ts");
      });
    } catch (e) {
    }
  }
  window.addEventListener("gc_wallet_connected", (e) => {
    const address = e.detail?.address;
    if (address) {
      chrome.storage.local.set({ connectedAddress: address });
    }
  });
  var interval = setInterval(checkAndBridge, 300);
  setTimeout(() => clearInterval(interval), 3e5);
})();
