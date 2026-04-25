"use strict";
(() => {
  // src/walletBridge.ts
  var ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
  var lastCheckedTs = "";
  function isValidAddress(address) {
    return ETH_ADDRESS_REGEX.test(address);
  }
  function checkAndBridge() {
    try {
      const address = localStorage.getItem("gc_wallet_address");
      const ts = localStorage.getItem("gc_wallet_ts");
      if (!address || !ts || ts === lastCheckedTs) return;
      if (!isValidAddress(address)) {
        localStorage.removeItem("gc_wallet_address");
        localStorage.removeItem("gc_wallet_ts");
        return;
      }
      const age = Date.now() - parseInt(ts);
      if (age > 3e4) {
        localStorage.removeItem("gc_wallet_address");
        localStorage.removeItem("gc_wallet_ts");
        return;
      }
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
    if (address && isValidAddress(address)) {
      chrome.storage.local.set({ connectedAddress: address });
    }
  });
  var interval = setInterval(checkAndBridge, 300);
  setTimeout(() => clearInterval(interval), 12e4);
})();
