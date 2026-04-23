// Popup script - Main entry point for extension UI
import { WalletStorage, truncateAddress } from './storage.js';
import { fetchProposals, fetchAllActiveProposals, fetchDAOProposals, DEFAULT_SPACE } from './snapshot.js';
import { transformProposal, formatNumber, DisplayProposal } from './proposals.js';

console.log('Snapshot Governance Extension - Popup loaded');

const HOSTED_PAGE_URL = 'http://localhost:3000';
const TRUSTED_ORIGIN = 'http://localhost:3000';

// ============================================
// Feature: Offline Detection
// ============================================

function updateOfflineBanner(): void {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  if (!navigator.onLine) {
    banner.style.display = 'block';
    document.body.classList.add('is-offline');
  } else {
    banner.style.display = 'none';
    document.body.classList.remove('is-offline');
  }
}

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

// ============================================
// Feature: DAO Logo Helper
// ============================================

function createDaoLogo(spaceId: string, label: string): HTMLElement {
  const img = document.createElement('img');
  img.className = 'dao-logo';
  img.alt = label;
  img.src = `https://cdn.stamp.fyi/space/${spaceId}?s=36`;

  // On error, replace with fallback initial badge
  img.onerror = () => {
    const fallback = document.createElement('div');
    fallback.className = 'dao-logo-fallback';
    fallback.textContent = label.charAt(0).toUpperCase();
    img.replaceWith(fallback);
  };

  return img;
}

const storage = new WalletStorage();
let isConnecting = false;

// ============================================
// Feature 2: Navigation State
// ============================================
type AppScreen = 'connect' | 'connected' | 'proposals' | 'detail';

const appState: {
  screen: AppScreen;
  proposals: DisplayProposal[];
  selectedProposal: DisplayProposal | null;
  address: string;
  activeTab: string;
} = {
  screen: 'connect',
  proposals: [],
  selectedProposal: null,
  address: '',
  activeTab: 'all'
};

let isLoadingProposals = false;

// Cache timestamp for hourly auto-reload
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let autoReloadTimer: number | undefined;

function hideAllScreens(): void {
  document.querySelectorAll('.screen').forEach(el => {
    (el as HTMLElement).style.display = 'none';
  });
}

function renderCurrentScreen(): void {
  hideAllScreens();
  switch (appState.screen) {
    case 'connect':
      showConnectScreen();
      break;
    case 'connected':
      showConnectedScreen(appState.address);
      break;
    case 'proposals':
      document.getElementById('screen-proposals')!.style.display = 'flex';
      break;
    case 'detail':
      document.getElementById('screen-detail')!.style.display = 'flex';
      if (!appState.selectedProposal) return;
      renderProposalDetail(appState.selectedProposal);
      break;
  }
}

function navigate(screen: AppScreen, data?: { proposal?: DisplayProposal }): void {
  appState.screen = screen;
  if (data?.proposal) appState.selectedProposal = data.proposal;
  renderCurrentScreen();
}

// ============================================
// Feature 1: UI State helpers (preserved)
// ============================================

// UI Elements (grabbed after DOM loads)
let disconnectedState: HTMLElement;
let connectingState: HTMLElement;
let connectedState: HTMLElement;
let errorState: HTMLElement;
let connectBtn: HTMLButtonElement;
let cancelBtn: HTMLButtonElement;
let disconnectBtn: HTMLButtonElement;
let changeWalletBtn: HTMLButtonElement;
let walletAddressEl: HTMLElement;
let errorTextEl: HTMLElement;

function showConnectScreen(): void {
  disconnectedState.style.display = 'block';
  connectingState.style.display = 'none';
  connectedState.style.display = 'none';
  errorState.style.display = 'none';
}

function showConnectedScreen(address: string): void {
  walletAddressEl.textContent = truncateAddress(address);
  disconnectedState.style.display = 'none';
  connectingState.style.display = 'none';
  connectedState.style.display = 'block';
  errorState.style.display = 'none';
}

function showState(state: 'disconnected' | 'connecting' | 'connected' | 'error') {
  disconnectedState.classList.add('hidden');
  connectingState.classList.add('hidden');
  connectedState.classList.add('hidden');
  errorState.classList.add('hidden');

  if (state === 'disconnected') disconnectedState.classList.remove('hidden');
  if (state === 'connecting')   connectingState.classList.remove('hidden');
  if (state === 'connected')    connectedState.classList.remove('hidden');
  if (state === 'error')        errorState.classList.remove('hidden');
}

function showConnected(address: string) {
  appState.address = address;
  walletAddressEl.textContent = truncateAddress(address);
  showState('connected');
}

function showError(msg: string) {
  errorTextEl.textContent = msg;
  showState('error');
  isConnecting = false;
}

function connectWallet() {
  isConnecting = true;
  showState('connecting');

  const features = 'width=420,height=640,left=200,top=100';
  const popup = window.open(HOSTED_PAGE_URL, 'walletConnect', features);

  if (!popup) {
    showError('Popup was blocked. Please allow popups for this extension.');
    return;
  }
}

// Listen for messages from hosted page
window.addEventListener('message', async (event) => {
  console.log('Received message:', event.data, 'from:', event.origin);

  if (event.origin !== TRUSTED_ORIGIN) {
    console.warn('Ignored message from untrusted origin:', event.origin);
    return;
  }

  if (!isConnecting) return;

  if (event.data?.type === 'WALLET_CONNECTED') {
    const address = event.data.address;
    console.log('Wallet connected! Address:', address);

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      showError('Invalid wallet address received.');
      return;
    }

    try {
      await chrome.storage.local.set({ connectedAddress: address });
      isConnecting = false;
      showConnected(address);
    } catch (err) {
      showError('Failed to save wallet address.');
    }
  }

  if (event.data?.type === 'CONNECTION_ERROR') {
    console.log('Connection error received');
    showError(event.data.error || 'Connection failed. Please try again.');
  }
});

async function changeWallet() {
  await chrome.storage.local.remove('connectedAddress');
  isConnecting = true;
  showState('connecting');

  const features = 'width=420,height=640,left=200,top=100';
  const popup = window.open(HOSTED_PAGE_URL, 'walletConnect', features);

  if (!popup) {
    showError('Popup was blocked. Please allow popups for this extension.');
  }
}

async function disconnectWallet() {
  await chrome.storage.local.remove('connectedAddress');
  appState.address = '';
  appState.proposals = [];
  showState('disconnected');
}

// ============================================
// Feature 2: Proposals List Rendering
// ============================================

function showProposalsLoading(): void {
  document.getElementById('proposals-loading')!.style.display = 'flex';
  document.getElementById('proposals-list')!.style.display = 'none';
  document.getElementById('proposals-empty')!.style.display = 'none';
  document.getElementById('proposals-error')!.style.display = 'none';
}

function showProposalsEmpty(): void {
  document.getElementById('proposals-loading')!.style.display = 'none';
  document.getElementById('proposals-list')!.style.display = 'none';
  document.getElementById('proposals-empty')!.style.display = 'block';
  document.getElementById('proposals-error')!.style.display = 'none';
}

function showProposalsError(msg: string): void {
  document.getElementById('proposals-loading')!.style.display = 'none';
  document.getElementById('proposals-list')!.style.display = 'none';
  document.getElementById('proposals-empty')!.style.display = 'none';
  document.getElementById('proposals-error')!.style.display = 'block';
  document.getElementById('proposals-error-msg')!.textContent = msg;
}

function renderProposalsList(proposals: DisplayProposal[]): void {
  const list = document.getElementById('proposals-list')!;
  list.innerHTML = ''; // safe — clearing container only

  const safeProposals = proposals.filter(Boolean);
  if (!safeProposals.length) {
    showProposalsEmpty();
    return;
  }

  document.getElementById('proposals-loading')!.style.display = 'none';
  document.getElementById('proposals-empty')!.style.display = 'none';
  document.getElementById('proposals-error')!.style.display = 'none';
  list.style.display = 'block';

  const frag = document.createDocumentFragment();

  for (const p of safeProposals) {
    const card = document.createElement('div');
    card.className = 'proposal-card';
    card.onclick = () => navigate('detail', { proposal: p });

    // Header row: space logo + name + badge
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';

    const spaceRow = document.createElement('div');
    spaceRow.className = 'card-space-row';

    const logo = createDaoLogo(p.spaceId, p.spaceName);
    const spaceName = document.createElement('span');
    spaceName.className = 'card-space';
    spaceName.textContent = p.spaceName;

    spaceRow.appendChild(logo);
    spaceRow.appendChild(spaceName);

    const badge = document.createElement('span');
    badge.className = `badge badge-${p.state}`;
    badge.textContent = p.state.toUpperCase();

    cardHeader.appendChild(spaceRow);
    cardHeader.appendChild(badge);

    // Title
    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = p.title;

    card.appendChild(cardHeader);
    card.appendChild(title);

    // Top-2 choices (only when votes exist)
    if (p.scores_total > 0 && p.percentages.length > 0) {
      const pairs = p.choices
        .map((c, i) => ({ choice: c, percent: p.percentages[i] || 0, score: p.scores[i] || 0 }))
        .filter((_, i) => p.choices[i] !== undefined && p.percentages[i] !== undefined);

      pairs.sort((a, b) => b.percent - a.percent);
      const topTwo = pairs.slice(0, 2);
      const colors = ['green', 'red'];

      topTwo.forEach(({ choice, percent, score }, idx) => {
        const row = document.createElement('div');
        row.className = 'choice-row';

        const label = document.createElement('span');
        label.className = `choice-label color-${colors[idx]}`;
        label.textContent = `${choice} ${percent}%`;

        const vpSpan = document.createElement('span');
        vpSpan.className = 'vp-amount';
        vpSpan.textContent = formatVotingPower(score);

        const bar = document.createElement('div');
        bar.className = 'progress-bar';
        const fill = document.createElement('div');
        fill.className = `progress-fill fill-${colors[idx]}`;
        fill.style.width = `${percent}%`;
        bar.appendChild(fill);

        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(vpSpan);
        card.appendChild(row);
      });
    } else {
      const noVotes = document.createElement('p');
      noVotes.className = 'card-time';
      noVotes.style.fontStyle = 'italic';
      if (p.state === 'active') noVotes.textContent = 'No votes yet';
      else if (p.state === 'pending') noVotes.textContent = 'Voting not started';
      else noVotes.textContent = 'No votes cast';
      card.appendChild(noVotes);
    }

    // Time label — highlight urgent endings
    const timeLabel = p.timeLabel;
    const isUrgent = p.state === 'active' && (
      timeLabel.includes('Ending soon') ||
      (timeLabel.includes('Ends in') && !timeLabel.includes('d '))
    );
    const time = document.createElement('p');
    time.className = isUrgent ? 'time-urgent' : 'time-normal';
    time.textContent = timeLabel;
    card.appendChild(time);

    // Timeline — horizontal dot-line (Start → Now → End)
    if (p.start && p.end) {
      const pct = calcTimelinePercent(p.start, p.end, p.state);
      const isEnded = p.state === 'closed';
      const isPending = p.state === 'pending';

      const tlSection = document.createElement('div');
      tlSection.className = 'timeline-section';

      const tlRow = document.createElement('div');
      tlRow.className = 'timeline-horizontal';

      // Start node
      const startNode = document.createElement('div');
      startNode.className = 'timeline-node';
      const startDot = document.createElement('div');
      startDot.className = 'timeline-dot';
      const startLbl = document.createElement('div');
      startLbl.className = 'timeline-node-label';
      startLbl.textContent = 'Start';
      const startDate = document.createElement('div');
      startDate.className = 'timeline-node-date';
      startDate.textContent = new Date(p.start * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      startNode.appendChild(startDot);
      startNode.appendChild(startLbl);
      startNode.appendChild(startDate);

      // Line with fill
      const line = document.createElement('div');
      line.className = 'timeline-line';
      const lineFill = document.createElement('div');
      lineFill.className = `timeline-line-fill${isEnded ? ' ended' : isPending ? ' pending-line' : ''}`;
      lineFill.style.width = `${pct}%`;
      line.appendChild(lineFill);

      // End node
      const endNode = document.createElement('div');
      endNode.className = 'timeline-node';
      const endDot = document.createElement('div');
      endDot.className = `timeline-dot${isEnded ? '' : ' inactive'}`;
      const endLbl = document.createElement('div');
      endLbl.className = 'timeline-node-label';
      endLbl.textContent = 'End';
      const endDate = document.createElement('div');
      endDate.className = 'timeline-node-date';
      endDate.textContent = new Date(p.end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      endNode.appendChild(endDot);
      endNode.appendChild(endLbl);
      endNode.appendChild(endDate);

      tlRow.appendChild(startNode);
      tlRow.appendChild(line);
      tlRow.appendChild(endNode);
      tlSection.appendChild(tlRow);

      // Closed tag below timeline
      if (isEnded) {
        const closedTag = document.createElement('div');
        closedTag.className = 'timeline-closed-tag';
        closedTag.textContent = '✓ Event Closed';
        tlSection.appendChild(closedTag);
      }

      card.appendChild(tlSection);
    }

    frag.appendChild(card);
  }

  list.appendChild(frag);
}

// ============================================
// Feature 2: Proposal Detail Rendering
// ============================================

function renderProposalDetail(proposal: DisplayProposal): void {
  const container = document.getElementById('detail-content')!;
  container.innerHTML = ''; // safe — clearing container only

  // Header: space + badge
  const header = document.createElement('div');
  header.className = 'detail-header';

  const spaceRow = document.createElement('div');
  spaceRow.className = 'detail-space-logo-row';

  const detailLogo = createDaoLogo(proposal.spaceId, proposal.spaceName);
  const spaceName = document.createElement('span');
  spaceName.textContent = proposal.spaceName;

  const badge = document.createElement('span');
  badge.className = `badge badge-${proposal.state}`;
  badge.textContent = proposal.state.toUpperCase();

  spaceRow.appendChild(detailLogo);
  spaceRow.appendChild(spaceName);
  spaceRow.appendChild(badge);

  const title = document.createElement('p');
  title.className = 'detail-title';
  title.textContent = proposal.title;

  const time = document.createElement('p');
  time.className = 'detail-time';
  time.textContent = proposal.timeLabel;

  header.appendChild(spaceRow);
  header.appendChild(title);
  header.appendChild(time);
  container.appendChild(header);

  // Description
  const descLabel = document.createElement('p');
  descLabel.className = 'detail-section-label';
  descLabel.textContent = 'Description';
  container.appendChild(descLabel);

  const body = document.createElement('p');
  body.className = 'detail-body';
  body.textContent = proposal.bodyDetail || 'No description available.';
  container.appendChild(body);

  // Divider
  const div1 = document.createElement('div');
  div1.className = 'detail-divider';
  container.appendChild(div1);

  // Votes section
  const votesLabel = document.createElement('p');
  votesLabel.className = 'detail-section-label';
  votesLabel.textContent = 'Current Votes';
  container.appendChild(votesLabel);

  if (proposal.scores_total > 0 && proposal.percentages.length > 0) {
    const pairs = proposal.choices
      .map((c, i) => ({ choice: c, percent: proposal.percentages[i] || 0, score: proposal.scores[i] || 0, idx: i }))
      .filter(item => proposal.choices[item.idx] !== undefined && proposal.percentages[item.idx] !== undefined);

    const sorted = [...pairs].sort((a, b) => b.percent - a.percent);
    const rankColors = ['green', 'red'];
    const colorByChoice = new Map<string, string>();
    sorted.forEach((item, rank) => {
      colorByChoice.set(item.choice, rankColors[rank] || 'grey');
    });

    pairs.forEach(({ choice, percent, score }) => {
      const color = colorByChoice.get(choice) || 'grey';
      const row = document.createElement('div');
      row.className = 'detail-choice-row';

      const label = document.createElement('span');
      label.className = `detail-choice-label color-${color}`;
      label.textContent = choice;

      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      const fill = document.createElement('div');
      fill.className = `progress-fill fill-${color}`;
      fill.style.width = `${percent}%`;
      bar.appendChild(fill);

      const pct = document.createElement('span');
      pct.className = `detail-choice-pct color-${color}`;
      pct.textContent = `${percent}%`;

      const vp = document.createElement('span');
      vp.className = 'vp-amount';
      vp.textContent = formatVotingPower(score);

      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(pct);
      row.appendChild(vp);
      container.appendChild(row);
    });
  } else {
    const noVotes = document.createElement('p');
    noVotes.className = 'detail-body';
    noVotes.textContent = 'No votes recorded yet.';
    container.appendChild(noVotes);
  }

  // Divider
  const div2 = document.createElement('div');
  div2.className = 'detail-divider';
  container.appendChild(div2);

  // Timeline in detail view — horizontal dot-line
  if (proposal.start && proposal.end) {
    const pct = calcTimelinePercent(proposal.start, proposal.end, proposal.state);
    const isEnded = proposal.state === 'closed';
    const isPending = proposal.state === 'pending';

    const tlSection = document.createElement('div');
    tlSection.className = 'detail-timeline-section';

    const tlLabel = document.createElement('p');
    tlLabel.className = 'detail-section-label';
    tlLabel.textContent = '⏱ Timeline';
    tlSection.appendChild(tlLabel);

    const tlRow = document.createElement('div');
    tlRow.className = 'detail-timeline-horizontal';

    function makeNode(label: string, ts: number, active: boolean) {
      const node = document.createElement('div');
      node.className = 'detail-timeline-node';
      const dot = document.createElement('div');
      dot.className = `detail-timeline-dot${active ? '' : ' inactive'}`;
      const lbl = document.createElement('div');
      lbl.className = 'detail-timeline-node-label';
      lbl.textContent = label;
      const date = document.createElement('div');
      date.className = 'detail-timeline-node-date';
      const d = new Date(ts * 1000);
      date.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      node.appendChild(dot);
      node.appendChild(lbl);
      node.appendChild(date);
      return node;
    }

    const startNode = makeNode('Start', proposal.start, true);
    const line = document.createElement('div');
    line.className = 'detail-timeline-line';
    const lineFill = document.createElement('div');
    lineFill.className = `detail-timeline-line-fill${isEnded ? ' ended' : ''}`;
    lineFill.style.width = isPending ? '0%' : `${pct}%`;
    line.appendChild(lineFill);
    const endNode = makeNode('End', proposal.end, isEnded);

    tlRow.appendChild(startNode);
    tlRow.appendChild(line);
    tlRow.appendChild(endNode);
    tlSection.appendChild(tlRow);

    // Closed tag
    if (isEnded) {
      const closedTag = document.createElement('div');
      closedTag.className = 'timeline-closed-tag';
      closedTag.textContent = '✓ Event Closed';
      tlSection.appendChild(closedTag);
    }

    container.appendChild(tlSection);
  }

  // Divider
  const div3 = document.createElement('div');
  div3.className = 'detail-divider';
  container.appendChild(div3);

  // Vote buttons (disabled)
  const voteLabel = document.createElement('p');
  voteLabel.className = 'detail-section-label';
  voteLabel.textContent = 'Cast Your Vote';
  container.appendChild(voteLabel);

  const voteButtons = document.createElement('div');
  voteButtons.className = 'vote-buttons';

  proposal.choices.forEach(choice => {
    if (!choice) return;
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = choice;
    btn.disabled = true;
    voteButtons.appendChild(btn);
  });

  container.appendChild(voteButtons);

  const note = document.createElement('p');
  note.className = 'vote-note';
  note.textContent = 'Voting coming in next update';
  container.appendChild(note);

  // Read Full Proposal button
  const readBtn = document.createElement('a');
  readBtn.className = 'read-full-btn';
  readBtn.textContent = '↗ Read Full Proposal';
  readBtn.href = `https://snapshot.org/#/${proposal.spaceId}/proposal/${proposal.id}`;
  readBtn.target = '_blank';
  readBtn.rel = 'noopener noreferrer';
  container.appendChild(readBtn);
}

// ============================================
// Feature 2: Tab UI
// ============================================

function updateActiveTabUI(): void {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`.tab[data-tab="${appState.activeTab}"]`)?.classList.add('active');
}

function bindTabEvents(): void {
  document.querySelectorAll('.tab').forEach(btn => {
    const tabEl = btn as HTMLElement;
    const tabId = tabEl.dataset.tab!;
    const label = tabEl.textContent?.trim() || tabId;

    // Add logo to tab (non-critical — wrap existing text)
    if (tabId !== 'all') {
      tabEl.innerHTML = ''; // safe — no API data
      const inner = document.createElement('span');
      inner.className = 'tab-inner';
      const logo = createDaoLogo(tabId, label);
      const text = document.createElement('span');
      text.textContent = label;
      inner.appendChild(logo);
      inner.appendChild(text);
      tabEl.appendChild(inner);
    }

    tabEl.addEventListener('click', async (e) => {
      const tab = (e.currentTarget as HTMLElement).dataset.tab!;
      if (appState.activeTab === tab) return;
      appState.activeTab = tab;
      appState.proposals = [];
      lastFetchTime = 0;
      updateActiveTabUI();
      await loadProposalsByTab();
    });
  });
}

// ============================================
// Feature 2: Voting Power Formatter
// ============================================

function formatVotingPower(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

// ============================================
// Feature 2: Timeline Calculator
// ============================================

function calcTimelinePercent(start: number, end: number, state: string): number {
  if (state === 'pending') return 0;
  if (state === 'closed')  return 100;
  const now = Math.floor(Date.now() / 1000);
  const total = end - start;
  if (total <= 0) return 100;
  const elapsed = now - start;
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

// ============================================
// Feature 2: Last Updated Label
// ============================================

function updateLastUpdatedLabel(): void {
  const el = document.getElementById('last-updated-label');
  if (!el) return;
  if (!lastFetchTime) { el.textContent = ''; return; }
  const mins = Math.floor((Date.now() - lastFetchTime) / 60000);
  el.textContent = mins < 1 ? 'Updated just now' : `Updated ${mins}m ago`;
}

// ============================================
// Feature 2: Load Proposals
// ============================================

async function loadProposalsByTab(forceReload = false): Promise<void> {
  if (isLoadingProposals) return;

  // Offline guard
  if (!navigator.onLine) {
    showProposalsError('You are offline. Please check your connection and try again.');
    return;
  }

  // Use cache if within TTL and not forced
  if (!forceReload && lastFetchTime && (Date.now() - lastFetchTime) < CACHE_TTL_MS) {
    if (appState.proposals.length > 0) {
      renderProposalsList(appState.proposals);
      return;
    }
  }

  isLoadingProposals = true;
  showProposalsLoading();

  // Show loading spinner inside reload button
  const reloadBtn = document.getElementById('btn-reload-proposals');
  reloadBtn?.classList.add('loading');

  try {
    let raw;
    if (appState.activeTab === 'all') {
      raw = await fetchAllActiveProposals();
    } else {
      raw = await fetchDAOProposals(appState.activeTab);
    }

    console.log('DAO:', appState.activeTab, '| Proposals fetched:', raw.length);

    const proposals = raw.map(transformProposal).filter(Boolean) as DisplayProposal[];
    appState.proposals = proposals;
    lastFetchTime = Date.now();
    updateLastUpdatedLabel();

    if (proposals.length === 0) {
      showProposalsEmpty();
    } else {
      renderProposalsList(proposals);
    }

    // Schedule next auto-reload
    if (autoReloadTimer) clearTimeout(autoReloadTimer);
    autoReloadTimer = window.setTimeout(() => {
      if (appState.screen === 'proposals') {
        loadProposalsByTab(true);
      }
    }, CACHE_TTL_MS);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load proposals';
    showProposalsError(msg);
  } finally {
    isLoadingProposals = false;
    reloadBtn?.classList.remove('loading');
  }
}

// ============================================
// Initialize
// ============================================

async function initialize() {
  // Grab Feature 1 DOM elements
  disconnectedState = document.getElementById('disconnected-state')!;
  connectingState   = document.getElementById('connecting-state')!;
  connectedState    = document.getElementById('connected-state')!;
  errorState        = document.getElementById('error-state')!;
  connectBtn        = document.getElementById('connect-btn') as HTMLButtonElement;
  cancelBtn         = document.getElementById('cancel-btn') as HTMLButtonElement;
  disconnectBtn     = document.getElementById('disconnect-btn') as HTMLButtonElement;
  changeWalletBtn   = document.getElementById('change-wallet-btn') as HTMLButtonElement;
  walletAddressEl   = document.getElementById('wallet-address')!;
  errorTextEl       = document.getElementById('error-text')!;

  // Feature 1 button wiring
  connectBtn.addEventListener('click', connectWallet);
  document.getElementById('retry-btn')!.addEventListener('click', connectWallet);
  changeWalletBtn.addEventListener('click', changeWallet);
  cancelBtn.addEventListener('click', () => {
    isConnecting = false;
    showState('disconnected');
  });
  disconnectBtn.addEventListener('click', disconnectWallet);

  // Feature 2 button wiring
  document.getElementById('btn-proposals')!.addEventListener('click', async () => {
    appState.activeTab = 'all';
    navigate('proposals');
    updateActiveTabUI();
    await loadProposalsByTab();
  });

  document.getElementById('btn-back-proposals')!.addEventListener('click', () => {
    navigate('connected');
  });

  document.getElementById('btn-back-detail')!.addEventListener('click', () => {
    navigate('proposals');
    // Use cached proposals — no re-fetch, preserve active tab
    if (appState.proposals.length > 0) {
      renderProposalsList(appState.proposals);
    }
  });

  document.getElementById('btn-reload-proposals')!.addEventListener('click', () => {
    lastFetchTime = 0; // force reload
    loadProposalsByTab(true);
  });

  document.getElementById('btn-retry')!.addEventListener('click', loadProposalsByTab);

  // Bind tab click events
  bindTabEvents();

  // Check for existing wallet connection
  const result = await chrome.storage.local.get('connectedAddress');
  if (result.connectedAddress) {
    appState.address = result.connectedAddress;
    showConnected(result.connectedAddress);
  } else {
    showState('disconnected');
  }

  // Initial offline check
  updateOfflineBanner();
}

document.addEventListener('DOMContentLoaded', initialize);
