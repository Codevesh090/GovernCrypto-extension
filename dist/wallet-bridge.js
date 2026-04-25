"use strict";
(() => {
  // src/walletBridge.ts
  function checkAndBridge() {
    const address = localStorage.getItem("gc_wallet_address");
    const ts = localStorage.getItem("gc_wallet_ts");
    if (!address || !ts) return;
    const age = Date.now() - parseInt(ts);
    if (age > 3e4) return;
    chrome.storage.local.set({ connectedAddress: address }, () => {
      localStorage.removeItem("gc_wallet_address");
      localStorage.removeItem("gc_wallet_ts");
    });
  }
  checkAndBridge();
  var interval = setInterval(checkAndBridge, 500);
  setTimeout(() => clearInterval(interval), 3e5);
})();
