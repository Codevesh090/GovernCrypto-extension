/**
 * signer.js — runs in a normal extension popup window.
 * MetaMask IS injected here (unlike the side panel).
 *
 * Receives typed data via postMessage from the side panel,
 * calls eth_signTypedData_v4, sends signature back, closes.
 */

const statusEl  = document.getElementById('status');
const spinnerEl = document.getElementById('spinner');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className   = isError ? 'error' : '';
  if (isError) spinnerEl.style.display = 'none';
}

async function sign(typedData, address) {
  const ethereum = window.ethereum;
  if (!ethereum) {
    throw new Error('MetaMask not found. Please install MetaMask.');
  }

  // Request accounts first to ensure MetaMask is unlocked
  try {
    await ethereum.request({ method: 'eth_requestAccounts' });
  } catch (err) {
    if (err.code === 4001) throw new Error('Wallet access denied.');
    throw err;
  }

  const signature = await ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)]
  });

  return signature;
}

// Listen for the typed data from the side panel
window.addEventListener('message', async (event) => {
  if (event.data?.type !== 'SIGN_VOTE') return;

  const { typedData, address } = event.data;

  try {
    setStatus('Waiting for MetaMask approval...', false);
    const signature = await sign(typedData, address);

    // Send signature back to opener
    if (window.opener) {
      window.opener.postMessage({ type: 'SIGN_DONE', signature }, '*');
    }
    setStatus('Signed! Submitting vote...', false);
    setTimeout(() => window.close(), 800);

  } catch (err) {
    const msg =
      err.code === 4001 || err.message?.includes('rejected') ? 'Signature rejected.' :
      err.message || 'Signing failed.';
    setStatus(msg, true);

    if (window.opener) {
      window.opener.postMessage({ type: 'SIGN_ERROR', error: msg }, '*');
    }
    setTimeout(() => window.close(), 2000);
  }
});

// Tell opener we're ready
if (window.opener) {
  window.opener.postMessage({ type: 'SIGNER_READY' }, '*');
} else {
  setStatus('Error: no opener found.', true);
}
