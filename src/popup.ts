// Popup script - Main entry point for extension UI
import { WalletStorage, truncateAddress } from './storage.js';
import { fetchProposals, fetchAllActiveProposals, fetchDAOProposals, DEFAULT_SPACE } from './snapshot.js';
import { transformProposal, formatNumber, DisplayProposal } from './proposals.js';
import { generateSummary, getMistralApiKey, saveMistralApiKey, getElevenLabsApiKey } from './mistral.js';
import { getCachedSummary, cacheSummary } from './summaryCache.js';
import { parseSummary, renderSummary, getFallbackSummary } from './summaryRenderer.js';
import { recordWithSpeechAPI } from './voiceStt.js';
import { speakTextStream, stopSpeaking } from './voiceTts.js';
import { askAboutProposal, resetConversation, initConversation } from './voiceConversation.js';
import { castVote } from './snapshotVote.js';

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
type AppScreen = 'setup' | 'connect' | 'connected' | 'proposals' | 'detail';

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
    case 'setup':
      document.getElementById('screen-setup')!.style.display = 'flex';
      break;
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
      setVoiceState('idle');
      showVoiceTranscript('');
      // Pre-load proposal context for voice conversation
      initConversation(appState.selectedProposal);
      renderProposalDetail(appState.selectedProposal);
      // Load AI summary async — does not block detail render
      loadAISummary(appState.selectedProposal);
      // Start wake word listener
      setTimeout(() => startWakeWordListener(), 500);
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

// Listen for storage changes (real-time wallet connection detection)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.connectedAddress) {
    const newAddress = changes.connectedAddress.newValue;
    if (newAddress && appState.screen === 'connect') {
      console.log('Wallet connected via storage change:', newAddress);
      isConnecting = false;
      appState.address = newAddress;
      showConnected(newAddress);
    }
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
// Feature 3: Setup Screen Logic
// ============================================

function showSetupError(msg: string): void {
  const el = document.getElementById('setup-error')!;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideSetupError(): void {
  const el = document.getElementById('setup-error')!;
  el.style.display = 'none';
}

async function saveApiKeys(): Promise<void> {
  const mistral = (document.getElementById('input-mistral-key') as HTMLInputElement).value.trim();
  const eleven = (document.getElementById('input-elevenlabs') as HTMLInputElement).value.trim();

  if (!mistral || !eleven) {
    showSetupError('Both API keys are required.');
    return;
  }

  hideSetupError();

  // Store keys — never log them
  await saveMistralApiKey(mistral);
  await chrome.storage.local.set({ elevenLabsApiKey: eleven });

  // Clear inputs after saving
  (document.getElementById('input-mistral-key') as HTMLInputElement).value = '';
  (document.getElementById('input-elevenlabs') as HTMLInputElement).value = '';

  navigate('connect');
}

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

  // AI Summary section — injected right after title
  const summaryWrapper = document.createElement('div');
  summaryWrapper.id = 'detail-summary-wrapper';
  summaryWrapper.style.cssText = 'padding: 12px 16px 0;';

  const summaryBadge = document.createElement('div');
  summaryBadge.className = 'summary-badge';
  summaryBadge.textContent = '⚡ AI Summary';

  const summaryLoading = document.createElement('div');
  summaryLoading.id = 'summary-loading';
  summaryLoading.className = 'summary-loading';
  summaryLoading.innerHTML = '<div class="summary-spinner"></div><span>AI is analyzing this proposal...</span>';

  const summaryError = document.createElement('div');
  summaryError.id = 'summary-error';
  summaryError.className = 'summary-error';
  summaryError.style.display = 'none';
  summaryError.textContent = 'Could not generate AI summary.';

  const summaryNoKey = document.createElement('div');
  summaryNoKey.id = 'summary-no-key';
  summaryNoKey.className = 'summary-error';
  summaryNoKey.style.display = 'none';
  summaryNoKey.textContent = 'Please add your Mistral API key in settings.';

  const summaryFallback = document.createElement('div');
  summaryFallback.id = 'summary-fallback';
  summaryFallback.className = 'summary-fallback';
  summaryFallback.style.display = 'none';

  const summaryContent = document.createElement('div');
  summaryContent.id = 'detail-summary';
  summaryContent.style.display = 'none';

  summaryWrapper.appendChild(summaryBadge);
  summaryWrapper.appendChild(summaryLoading);
  summaryWrapper.appendChild(summaryError);
  summaryWrapper.appendChild(summaryNoKey);
  summaryWrapper.appendChild(summaryFallback);
  summaryWrapper.appendChild(summaryContent);
  container.appendChild(summaryWrapper);

  const summaryDivider = document.createElement('hr');
  summaryDivider.className = 'summary-divider';
  container.appendChild(summaryDivider);

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

  // Vote buttons
  const voteLabel = document.createElement('p');
  voteLabel.className = 'detail-section-label';
  voteLabel.textContent = 'Cast Your Vote';
  container.appendChild(voteLabel);

  const voteButtons = document.createElement('div');
  voteButtons.className = 'vote-buttons';

  const isActive = proposal.state === 'active';

  proposal.choices.forEach((choice, idx) => {
    if (!choice) return;
    const btn = document.createElement('button');
    btn.className   = 'vote-btn';
    btn.textContent = choice;
    btn.disabled    = !isActive;

    if (isActive) {
      btn.addEventListener('click', () =>
        handleVoteClick(proposal, idx + 1, voteButtons, voteStatus)
      );
    }
    voteButtons.appendChild(btn);
  });

  container.appendChild(voteButtons);

  // Vote status message (replaces "Voting coming in next update")
  const voteStatus = document.createElement('p');
  voteStatus.className = 'vote-status';
  voteStatus.textContent = isActive ? '' : 'Voting is closed for this proposal';
  container.appendChild(voteStatus);

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
// Feature 3: AI Summary
// ============================================

const MIN_LOADER_MS = 300;

function resetSummarySection(): void {
  document.getElementById('summary-loading')!.style.display = 'flex';
  document.getElementById('summary-error')!.style.display = 'none';
  document.getElementById('summary-no-key')!.style.display = 'none';
  document.getElementById('summary-fallback')!.style.display = 'none';
  document.getElementById('detail-summary')!.style.display = 'none';
}

function showSummaryNoKey(): void {
  document.getElementById('summary-loading')!.style.display = 'none';
  document.getElementById('summary-no-key')!.style.display = 'block';
}

function showSummaryError(fallbackText: string): void {
  document.getElementById('summary-loading')!.style.display = 'none';
  document.getElementById('summary-error')!.style.display = 'block';
  if (fallbackText) {
    const el = document.getElementById('summary-fallback')!;
    el.textContent = fallbackText; // textContent — never innerHTML
    el.style.display = 'block';
  }
}

async function holdMinLoader(loadStart: number): Promise<void> {
  const elapsed = Date.now() - loadStart;
  if (elapsed < MIN_LOADER_MS) {
    await new Promise(r => setTimeout(r, MIN_LOADER_MS - elapsed));
  }
}

async function loadAISummary(proposal: DisplayProposal): Promise<void> {
  resetSummarySection();
  const loadStart = Date.now();

  // Check Mistral API key
  const apiKey = await getMistralApiKey();

  if (!apiKey) {
    await holdMinLoader(loadStart);
    showSummaryNoKey();
    return;
  }

  // Check cache
  let summary = await getCachedSummary(proposal.id);

  if (!summary) {
    try {
      summary = await generateSummary(proposal.bodyFull, apiKey);
      await cacheSummary(proposal.id, summary);
    } catch (err) {
      console.error('AI Summary generation failed:', err);
      await holdMinLoader(loadStart);
      showSummaryError(getFallbackSummary(proposal.bodyFull));
      return;
    }
  }

  await holdMinLoader(loadStart);

  const sections = parseSummary(summary);
  const container = document.getElementById('detail-summary')!;
  renderSummary(sections, container);

  document.getElementById('summary-loading')!.style.display = 'none';
  container.style.display = 'block';
}

// ============================================
// Feature 5: Voting
// ============================================

function setVoteButtons(container: HTMLElement, disabled: boolean): void {
  container.querySelectorAll<HTMLButtonElement>('.vote-btn').forEach(btn => {
    btn.disabled = disabled;
  });
}

async function handleVoteClick(
  proposal: DisplayProposal,
  choiceIndex: number,
  buttonsContainer: HTMLElement,
  statusEl: HTMLElement
): Promise<void> {
  // Guard: wallet must be connected
  const result  = await chrome.storage.local.get('connectedAddress');
  const address: string | undefined = result.connectedAddress;
  if (!address) {
    statusEl.textContent = 'Connect wallet first';
    statusEl.className   = 'vote-status error';
    return;
  }

  // Confirmation dialog
  const choiceName = proposal.choices[choiceIndex - 1] || `Choice ${choiceIndex}`;
  const confirmed  = window.confirm(`Vote "${choiceName}" on:\n"${proposal.title}"?`);
  if (!confirmed) return;

  // Disable buttons + show loading
  setVoteButtons(buttonsContainer, true);
  statusEl.textContent = 'Submitting vote...';
  statusEl.className   = 'vote-status loading';

  try {
    await castVote(proposal.id, proposal.spaceId, choiceIndex, address);
    statusEl.textContent = 'Vote submitted successfully ✅';
    statusEl.className   = 'vote-status success';
    // Keep buttons disabled after success
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Vote failed. Please try again.';

    if (msg.includes('already voted')) {
      statusEl.textContent = 'You have already voted on this proposal';
      statusEl.className   = 'vote-status error';
      // Keep buttons disabled
    } else if (msg === 'Signature rejected') {
      statusEl.textContent = 'Signature rejected';
      statusEl.className   = 'vote-status error';
      setVoteButtons(buttonsContainer, false);
    } else {
      statusEl.textContent = 'Vote failed. Please try again.';
      statusEl.className   = 'vote-status error';
      setVoteButtons(buttonsContainer, false);
    }
  }
}

// ============================================
// Feature 4: Voice AI Assistant
// ============================================

type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';
let voiceState: VoiceState = 'idle';
let stopRecording: (() => void) | null = null;

// Wake word listener — runs continuously on the detail screen
let wakeWordRecognition: any = null;
const WAKE_WORD = 'propo';

function startWakeWordListener(): void {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  if (wakeWordRecognition) return; // already running

  wakeWordRecognition = new SpeechRecognition();
  wakeWordRecognition.continuous     = true;
  wakeWordRecognition.interimResults = true;
  wakeWordRecognition.lang           = 'en-US';

  wakeWordRecognition.onresult = (event: any) => {
    // Only trigger if voice is idle
    if (voiceState !== 'idle') return;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.toLowerCase().trim();
      if (text.includes(WAKE_WORD)) {
        // Wake word detected — stop listener and start full voice flow
        stopWakeWordListener();
        handleVoiceButtonClick();
        break;
      }
    }
  };

  wakeWordRecognition.onend = () => {
    // Auto-restart if still on detail screen and idle
    if (appState.screen === 'detail' && voiceState === 'idle' && wakeWordRecognition) {
      try { wakeWordRecognition.start(); } catch {}
    }
  };

  wakeWordRecognition.onerror = (e: any) => {
    // Restart on recoverable errors
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    wakeWordRecognition = null;
  };

  try {
    wakeWordRecognition.start();
    // Update status hint
    const statusEl = document.getElementById('voice-status');
    if (statusEl && voiceState === 'idle') {
      statusEl.textContent = 'Say "Propo" or tap to ask AI';
    }
  } catch {
    wakeWordRecognition = null;
  }
}

function stopWakeWordListener(): void {
  if (wakeWordRecognition) {
    try { wakeWordRecognition.stop(); } catch {}
    wakeWordRecognition = null;
  }
}

/** Play a short chime using Web Audio API — no external files needed */
function playChime(type: 'open' | 'close'): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'open') {
      // Rising two-tone: friendly "ding ding"
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else {
      // Falling tone: soft "dong"
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }

    osc.onended = () => ctx.close();
  } catch {
    // Audio not available — silent fail
  }
}

function setVoiceState(state: VoiceState): void {
  voiceState = state;
  const btn      = document.getElementById('btn-voice') as HTMLButtonElement | null;
  const statusEl = document.getElementById('voice-status');
  if (!btn || !statusEl) return;

  btn.disabled  = false;
  btn.className = '';
  statusEl.className = '';

  switch (state) {
    case 'idle':
      btn.textContent      = '🎙️ Ask AI';
      statusEl.textContent = 'Say "Propo" or tap to ask AI';
      // Restart wake word listener when returning to idle
      setTimeout(() => startWakeWordListener(), 300);
      break;
    case 'recording':
      btn.textContent    = '⏹ Stop';
      btn.classList.add('recording');
      statusEl.textContent = '🔴 Listening...';
      statusEl.classList.add('status-recording');
      break;
    case 'thinking':
      btn.textContent    = '⏳ Thinking...';
      btn.disabled       = true;
      statusEl.textContent = 'AI is thinking...';
      statusEl.classList.add('status-thinking');
      break;
    case 'speaking':
      btn.textContent    = '⏹ Stop';
      btn.classList.add('speaking');
      statusEl.textContent = '🔊 Speaking...';
      statusEl.classList.add('status-speaking');
      break;
  }
}

function showVoiceTranscript(text: string): void {
  const el = document.getElementById('voice-transcript');
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function showVoiceError(msg: string): void {
  const statusEl = document.getElementById('voice-status');
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.className   = 'status-error';
  }
  stopRecording = null;
  setVoiceState('idle');
}

async function handleVoiceButtonClick(): Promise<void> {
  // Stop speaking
  if (voiceState === 'speaking') {
    stopSpeaking();
    setVoiceState('idle');
    return;
  }

  // Stop recording early
  if (voiceState === 'recording') {
    stopRecording?.();
    return;
  }

  if (voiceState !== 'idle') return;

  const proposal   = appState.selectedProposal;
  if (!proposal) return;

  const elevenKey  = await getElevenLabsApiKey();
  const mistralKey = await getMistralApiKey();

  if (!elevenKey || !mistralKey) {
    showVoiceError('API keys missing — check setup.');
    return;
  }

  // Step 1: Record with Web Speech API (real-time transcript, no popup window)
  setVoiceState('recording');
  showVoiceTranscript('');
  stopWakeWordListener(); // pause wake word while recording
  playChime('open');

  const { promise, stop } = recordWithSpeechAPI(
    (interim, _isFinal) => {
      if (interim) showVoiceTranscript(interim);
    },
    2000
  );
  stopRecording = stop;

  let transcript: string;
  try {
    transcript = await promise;
  } catch (err: any) {
    console.error('[Voice] Recording failed:', err);
    showVoiceError(err?.message || 'Microphone access denied or unavailable.');
    return;
  } finally {
    stopRecording = null;
    playChime('close'); // 🔕 mic closed sound
  }

  if (!transcript) {
    showVoiceError('No speech detected. Try again.');
    setVoiceState('idle');
    return;
  }

  showVoiceTranscript(`"${transcript}"`);

  // Step 2: Mistral (context-aware, plain text response)
  setVoiceState('thinking');
  let answer: string;
  try {
    answer = await askAboutProposal(transcript, mistralKey);
  } catch (err: any) {
    console.error('[Voice] Mistral failed:', err);
    showVoiceError('AI response failed. Try again.');
    return;
  }

  // Step 3: TTS — speak the clean plain-text answer
  setVoiceState('speaking');
  try {
    await speakTextStream(answer, elevenKey);
  } catch (err: any) {
    console.error('[Voice] TTS failed:', err);
    showVoiceError('Could not play audio response.');
    return;
  }

  setVoiceState('idle');
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

  // Wire setup save button
  document.getElementById('btn-save-keys')!.addEventListener('click', saveApiKeys);

  // Allow Enter key to submit setup form
  document.getElementById('input-elevenlabs')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveApiKeys();
  });
  document.getElementById('input-mistral-key')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveApiKeys();
  });

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
    stopSpeaking();
    stopWakeWordListener();
    resetConversation();
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

  // Feature 4: Voice AI button
  document.getElementById('btn-voice')!.addEventListener('click', handleVoiceButtonClick);

  // Bind tab click events
  bindTabEvents();

  // Check for API keys first — show setup if missing
  const keysData = await chrome.storage.local.get(['mistralApiKey', 'elevenLabsApiKey']);
  if (!keysData.mistralApiKey || !keysData.elevenLabsApiKey) {
    navigate('setup');
    updateOfflineBanner();
    return;
  }

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
