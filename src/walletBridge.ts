/**
 * Content script injected into governcrypto.xyz/connect and /sign
 * Bridges localStorage on the hosted page to chrome.storage
 * so the extension popup can detect wallet connection instantly
 */

function checkAndBridge(): void {
  const address = localStorage.getItem('gc_wallet_address');
  const ts = localStorage.getItem('gc_wallet_ts');

  if (!address || !ts) return;

  // Only process recent connections (within last 30 seconds)
  const age = Date.now() - parseInt(ts);
  if (age > 30000) return;

  // Write to chrome.storage so the extension popup picks it up
  chrome.storage.local.set({ connectedAddress: address }, () => {
    // Clear the localStorage signal after bridging
    localStorage.removeItem('gc_wallet_address');
    localStorage.removeItem('gc_wallet_ts');
  });
}

// Check immediately and then every 500ms
checkAndBridge();
const interval = setInterval(checkAndBridge, 500);

// Stop after 5 minutes
setTimeout(() => clearInterval(interval), 300000);
