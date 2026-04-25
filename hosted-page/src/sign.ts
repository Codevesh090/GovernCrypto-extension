/**
 * sign.ts — GovernCrypto Vote Signing Page
 *
 * Uses EIP-6963 to discover ALL installed wallets (MetaMask, Backpack, etc.)
 * and lets the user explicitly choose which one to sign with.
 *
 * Flow:
 *  1. Read proposalId + choice from URL params
 *  2. Fetch proposal fresh from Snapshot GraphQL
 *  3. Discover wallets via EIP-6963 announcements
 *  4. Show wallet picker — user selects their wallet
 *  5. Connect + sign via eth_signTypedData_v4 with chosen provider
 *  6. POST signed vote to Snapshot relay
 *  7. Show success → notify extension → close tab
 */

const SNAPSHOT_API   = 'https://hub.snapshot.org/graphql';
const SNAPSHOT_RELAY = 'https://seq.snapshot.org/';

const DOMAIN = {
  name:    'snapshot',
  version: '0.1.4'
};

const VOTE_TYPES = {
  Vote: [
    { name: 'from',      type: 'address' },
    { name: 'space',     type: 'string'  },
    { name: 'timestamp', type: 'uint64'  },
    { name: 'proposal',  type: 'bytes32' },
    { name: 'choice',    type: 'uint32'  },
    { name: 'reason',    type: 'string'  },
    { name: 'app',       type: 'string'  },
    { name: 'metadata',  type: 'string'  },
  ]
};

// ── EIP-6963 types ────────────────────────────────────────
interface EIP6963ProviderInfo {
  uuid:  string;
  name:  string;
  icon:  string;
  rdns:  string;
}

interface EIP6963ProviderDetail {
  info:     EIP6963ProviderInfo;
  provider: any;
}

// ── DOM refs ──────────────────────────────────────────────
const loadingStateEl  = document.getElementById('loading-state')  as HTMLElement;
const voteContentEl   = document.getElementById('vote-content')   as HTMLElement;
const walletPickerEl  = document.getElementById('wallet-picker')  as HTMLElement;
const walletListEl    = document.getElementById('wallet-list')    as HTMLElement;
const titleEl         = document.getElementById('proposal-title') as HTMLElement;
const daoNameEl       = document.getElementById('dao-name')       as HTMLElement;
const choiceLabelEl   = document.getElementById('choice-label')   as HTMLElement;
const btnSign         = document.getElementById('btn-sign')        as HTMLButtonElement;
const statusEl        = document.getElementById('status')          as HTMLElement;

// ── State ─────────────────────────────────────────────────
let proposal:         any    = null;
let choiceIndex:      number = 0;
let selectedProvider: any    = null;
let selectedAddress:  string = '';
const discoveredWallets = new Map<string, EIP6963ProviderDetail>();

// ── Helpers ───────────────────────────────────────────────
function setStatus(msg: string, type?: string): void {
  statusEl.className = type || '';
  statusEl.innerHTML = type === 'loading'
    ? `<span class="spinner"></span>${msg}`
    : msg;
}

function showError(msg: string): void {
  setStatus(msg, 'error');
  btnSign.disabled = false;
}

// ── Fetch proposal ────────────────────────────────────────
async function fetchProposalById(id: string): Promise<any> {
  const query = `
    query GetProposal($id: String!) {
      proposal(id: $id) {
        id title choices state
        space { id name }
      }
    }
  `;
  const res = await fetch(SNAPSHOT_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query, variables: { id } })
  });
  if (!res.ok) throw new Error(`Snapshot API error: ${res.status}`);
  const json = await res.json();
  return json?.data?.proposal ?? null;
}

// ── EIP-6963 wallet discovery ─────────────────────────────
function discoverWallets(): Promise<EIP6963ProviderDetail[]> {
  return new Promise((resolve) => {
    // Collect announcements for 300ms then resolve
    const timeout = setTimeout(() => {
      resolve(Array.from(discoveredWallets.values()));
    }, 300);

    window.addEventListener('eip6963:announceProvider', (event: any) => {
      const detail = event.detail as EIP6963ProviderDetail;
      if (detail?.info?.uuid) {
        discoveredWallets.set(detail.info.uuid, detail);
        clearTimeout(timeout);
        // Reset timer to collect more wallets
        setTimeout(() => {
          resolve(Array.from(discoveredWallets.values()));
        }, 200);
      }
    });

    // Request all wallets to announce themselves
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  });
}

// ── Wallet picker UI ──────────────────────────────────────
function showWalletPicker(wallets: EIP6963ProviderDetail[]): void {
  walletListEl.innerHTML = '';

  if (wallets.length === 0) {
    // No EIP-6963 wallets — fall back to window.ethereum
    const eth = (window as any).ethereum;
    if (eth) {
      const fallback: EIP6963ProviderDetail = {
        info:     { uuid: 'legacy', name: 'Browser Wallet', icon: '', rdns: 'legacy' },
        provider: eth
      };
      wallets = [fallback];
    } else {
      walletListEl.innerHTML = '<p style="color:#EF0606;font-size:13px;">No wallets found. Please install MetaMask or Backpack.</p>';
      walletPickerEl.style.display = 'block';
      return;
    }
  }

  wallets.forEach(wallet => {
    const btn = document.createElement('button');
    btn.className = 'wallet-btn';

    const icon = document.createElement('img');
    icon.src    = wallet.info.icon;
    icon.alt    = wallet.info.name;
    icon.width  = 28;
    icon.height = 28;
    icon.style.cssText = 'border-radius:6px;flex-shrink:0;';
    icon.onerror = () => { icon.style.display = 'none'; };

    const name = document.createElement('span');
    name.textContent = wallet.info.name;

    btn.appendChild(icon);
    btn.appendChild(name);

    btn.addEventListener('click', () => selectWallet(wallet));
    walletListEl.appendChild(btn);
  });

  walletPickerEl.style.display = 'block';
}

async function selectWallet(wallet: EIP6963ProviderDetail): Promise<void> {
  walletPickerEl.style.display = 'none';
  setStatus(`Connecting to ${wallet.info.name}...`, 'loading');
  btnSign.disabled = true;

  try {
    let accounts: string[] = await wallet.provider.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) {
      accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
    }
    if (!accounts || accounts.length === 0) throw new Error('No account found.');

    selectedProvider = wallet.provider;
    selectedAddress  = accounts[0];

    setStatus(`Connected: ${selectedAddress.slice(0, 6)}...${selectedAddress.slice(-4)}`, 'success');
    btnSign.disabled = false;
    btnSign.textContent = `Sign with ${wallet.info.name}`;

  } catch (err: any) {
    showError(err.message || 'Wallet connection failed.');
    walletPickerEl.style.display = 'block';
  }
}

// ── Sign + Submit ─────────────────────────────────────────
async function signAndSubmit(): Promise<void> {
  if (!selectedProvider || !selectedAddress) {
    showError('Please select a wallet first.');
    return;
  }

  btnSign.disabled = true;
  setStatus('Waiting for wallet signature...', 'loading');

  const timestamp = Math.floor(Date.now() / 1000);

  const message = {
    from:      selectedAddress,
    space:     proposal.space.id,
    timestamp: timestamp,
    proposal:  proposal.id,
    choice:    choiceIndex,
    reason:    '',
    app:       'snapshot',
    metadata:  '{}'
  };

  const typedData = {
    domain:      DOMAIN,
    types:       VOTE_TYPES,
    primaryType: 'Vote',
    message
  };

  let signature: string;
  try {
    signature = await selectedProvider.request({
      method: 'eth_signTypedData_v4',
      params: [selectedAddress, JSON.stringify(typedData)]
    });
  } catch (err: any) {
    if (err.code === 4001 || err.message?.toLowerCase().includes('rejected')) {
      showError('Signature rejected. Your vote was not submitted.');
    } else {
      showError(`Signing failed: ${err.message || err}`);
    }
    return;
  }

  setStatus('Submitting vote to Snapshot...', 'loading');

  const relayPayload = {
    address: selectedAddress,
    sig:     signature,
    data:    { domain: DOMAIN, types: VOTE_TYPES, message }
  };

  try {
    const res = await fetch(SNAPSHOT_RELAY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(relayPayload)
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.error) {
      const errMsg = (json.error || `Relay error ${res.status}`).toString();
      if (errMsg.toLowerCase().includes('already voted')) {
        setStatus('You have already voted on this proposal.', 'error');
      } else if (errMsg.toLowerCase().includes('no name for address')) {
        showError('Vote failed: Your wallet address is not registered on Snapshot. Please ensure you have voting power for this proposal.');
      } else {
        showError(`Vote failed: ${errMsg}`);
      }
      return;
    }

    setStatus('Vote submitted successfully ✅', 'success');
    btnSign.textContent = 'Voted!';

    if (window.opener) {
      window.opener.postMessage({ type: 'VOTE_SUCCESS', proposalId: proposal.id }, '*');
    }

    setTimeout(() => window.close(), 2000);

  } catch (_err: any) {
    showError('Network error. Please try again.');
  }
}

// ── Init ──────────────────────────────────────────────────
async function init(): Promise<void> {
  const params     = new URLSearchParams(window.location.search);
  const proposalId = params.get('proposalId');
  choiceIndex      = parseInt(params.get('choice') || '0', 10);

  if (!proposalId || !choiceIndex || choiceIndex < 1) {
    loadingStateEl.textContent = 'Invalid vote link. Please go back and try again.';
    return;
  }

  try {
    proposal = await fetchProposalById(proposalId);
  } catch (err: any) {
    loadingStateEl.textContent = `Failed to load proposal: ${err.message}`;
    return;
  }

  if (!proposal) { loadingStateEl.textContent = 'Proposal not found.'; return; }
  if (proposal.state !== 'active') {
    loadingStateEl.textContent = 'This proposal is no longer active. Voting is closed.';
    return;
  }

  const choiceName = proposal.choices[choiceIndex - 1];
  if (!choiceName) { loadingStateEl.textContent = 'Invalid choice.'; return; }

  titleEl.textContent       = proposal.title;
  daoNameEl.textContent     = proposal.space?.name || proposal.space?.id || '';
  choiceLabelEl.textContent = choiceName;

  loadingStateEl.style.display = 'none';
  voteContentEl.style.display  = 'block';

  // Discover wallets and show picker
  const wallets = await discoverWallets();
  showWalletPicker(wallets);

  btnSign.addEventListener('click', signAndSubmit);
}

init();

export {};
