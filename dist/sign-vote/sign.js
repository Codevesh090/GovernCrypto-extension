/**
 * sign.js — GovernCrypto Vote Signing Page
 *
 * Runs in a full Chrome tab where MetaMask IS injected.
 * Flow:
 *  1. Read proposalId + choice from URL params
 *  2. Fetch proposal fresh from Snapshot GraphQL
 *  3. Connect wallet (silent first, then prompt)
 *  4. User clicks "Confirm & Sign"
 *  5. eth_signTypedData_v4 → MetaMask popup
 *  6. POST signed vote to Snapshot relay
 *  7. Show success → notify extension → close tab
 */

const SNAPSHOT_API   = 'https://hub.snapshot.org/graphql';
const SNAPSHOT_RELAY = 'https://seq.snapshot.org/';

// EIP-712 domain (Snapshot's fixed values)
const DOMAIN = { name: 'snapshot', version: '0.1.4' };

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

// ── DOM refs ──────────────────────────────────────────────
const loadingEl      = document.getElementById('loading-proposal');
const voteContentEl  = document.getElementById('vote-content');
const titleEl        = document.getElementById('proposal-title');
const daoNameEl      = document.getElementById('dao-name');
const choiceLabelEl  = document.getElementById('choice-label');
const btnSign        = document.getElementById('btn-sign');
const statusEl       = document.getElementById('status');

// ── State ─────────────────────────────────────────────────
let proposal   = null;
let choiceIndex = 0;   // 1-based
let voter      = null;

// ── Helpers ───────────────────────────────────────────────
function setStatus(msg, type) {
  statusEl.className   = type || '';
  statusEl.innerHTML   = type === 'loading'
    ? `<span class="spinner"></span>${msg}`
    : msg;
}

function showError(msg) {
  setStatus(msg, 'error');
  btnSign.disabled = false;
}

// ── Fetch proposal by ID ──────────────────────────────────
async function fetchProposalById(id) {
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
  return json?.data?.proposal || null;
}

// ── Connect wallet ────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    throw new Error('MetaMask not found. Please install MetaMask and reload.');
  }

  // Try silent first
  let accounts = await window.ethereum.request({ method: 'eth_accounts' });

  if (!accounts || accounts.length === 0) {
    // Prompt user
    accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  }

  if (!accounts || accounts.length === 0) {
    throw new Error('No wallet account found.');
  }

  return accounts[0];
}

// ── Sign + Submit ─────────────────────────────────────────
async function signAndSubmit() {
  btnSign.disabled = true;
  setStatus('Connecting wallet...', 'loading');

  try {
    voter = await connectWallet();
  } catch (err) {
    showError(err.message || 'Wallet connection failed.');
    return;
  }

  setStatus('Waiting for MetaMask signature...', 'loading');

  const message = {
    from:      voter,
    space:     proposal.space.id,
    timestamp: Math.floor(Date.now() / 1000),
    proposal:  proposal.id,
    choice:    choiceIndex,
    reason:    '',
    app:       'GovernCrypto',
    metadata:  '{}'
  };

  const typedData = {
    domain:      DOMAIN,
    types:       VOTE_TYPES,
    primaryType: 'Vote',
    message
  };

  let signature;
  try {
    signature = await window.ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [voter, JSON.stringify(typedData)]
    });
  } catch (err) {
    if (err.code === 4001 || err.message?.toLowerCase().includes('rejected')) {
      showError('Signature rejected. Your vote was not submitted.');
    } else {
      showError(`Signing failed: ${err.message || err}`);
    }
    return;
  }

  setStatus('Submitting vote to Snapshot...', 'loading');

  try {
    const res = await fetch(SNAPSHOT_RELAY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        address: voter,
        sig:     signature,
        data:    { domain: DOMAIN, types: VOTE_TYPES, message }
      })
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.error) {
      const errMsg = json.error || `Relay error ${res.status}`;
      if (errMsg.toLowerCase().includes('already voted')) {
        setStatus('You have already voted on this proposal.', 'error');
      } else {
        showError(`Vote failed: ${errMsg}`);
      }
      return;
    }

    // ✅ Success
    setStatus('Vote submitted successfully ✅', 'success');
    btnSign.textContent = 'Voted!';

    // Notify extension side panel
    if (window.opener) {
      window.opener.postMessage({
        type:       'VOTE_SUCCESS',
        proposalId: proposal.id
      }, '*');
    }

    // Auto-close after 2s
    setTimeout(() => window.close(), 2000);

  } catch {
    showError('Network error. Please try again.');
  }
}

// ── Init ──────────────────────────────────────────────────
async function init() {
  const params     = new URLSearchParams(window.location.search);
  const proposalId = params.get('proposalId');
  choiceIndex      = parseInt(params.get('choice') || '0', 10);

  // Validate params
  if (!proposalId || !choiceIndex || choiceIndex < 1) {
    loadingEl.textContent = 'Invalid vote link. Please go back and try again.';
    return;
  }

  // Fetch proposal fresh
  try {
    proposal = await fetchProposalById(proposalId);
  } catch (err) {
    loadingEl.textContent = `Failed to load proposal: ${err.message}`;
    return;
  }

  if (!proposal) {
    loadingEl.textContent = 'Proposal not found.';
    return;
  }

  if (proposal.state !== 'active') {
    loadingEl.textContent = 'This proposal is no longer active. Voting is closed.';
    return;
  }

  const choiceName = proposal.choices[choiceIndex - 1];
  if (!choiceName) {
    loadingEl.textContent = 'Invalid choice. Please go back and try again.';
    return;
  }

  // Populate UI
  titleEl.textContent    = proposal.title;
  daoNameEl.textContent  = proposal.space?.name || proposal.space?.id || '';
  choiceLabelEl.textContent = choiceName;

  loadingEl.style.display    = 'none';
  voteContentEl.style.display = 'block';

  btnSign.addEventListener('click', signAndSubmit);
}

init();
