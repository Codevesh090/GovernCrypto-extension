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
import { SUPPORTED_LANGUAGES, getLanguagePreference, saveLanguagePreference } from './languageStorage.js';
import { detectElevenLabsCapabilities, saveCapabilities, getCapabilities, getTierDisplayName } from './elevenLabsCapabilities.js';
import { getVoiceSettings, saveVoiceSettings, fetchAvailableVoices } from './voiceSettings.js';
import { playIfEnabled } from './soundEffects.js';
import { detectLanguage } from './languageDetection.js';
import { THEMES, getTheme, saveTheme, applyTheme, type ThemeName } from './themeStorage.js';

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
  proposalsSkip: number;
  hasMoreProposals: boolean;
} = {
  screen: 'connect',
  proposals: [],
  selectedProposal: null,
  address: '',
  activeTab: 'all',
  proposalsSkip: 0,
  hasMoreProposals: true
};

let isLoadingProposals = false;

// Cache timestamp for hourly auto-reload
let lastFetchTime = 0;
let lastFetchedTab = ''; // track which tab was last fetched
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

  const tab = window.open(HOSTED_PAGE_URL, '_blank');

  if (!tab) {
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
    if (newAddress) {
      console.log('Wallet connected via storage change:', newAddress);
      isConnecting = false;
      appState.address = newAddress;
      // Navigate to connected screen regardless of current screen
      if (appState.screen === 'connect') {
        showConnected(newAddress);
      }
    }
  }
});

async function changeWallet() {
  await chrome.storage.local.remove('connectedAddress');
  isConnecting = true;
  showState('connecting');

  const tab = window.open(HOSTED_PAGE_URL, '_blank');

  if (!tab) {
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
    await playIfEnabled('error');
    return;
  }

  hideSetupError();
  
  try {
    // Store keys — never log them
    await saveMistralApiKey(mistral);
    await chrome.storage.local.set({ elevenLabsApiKey: eleven });
    
    // Set optimistic capabilities - we'll check features on actual use
    const capabilities = await detectElevenLabsCapabilities(eleven);
    await saveCapabilities(capabilities);
    
    // Show success message
    const errorEl = document.getElementById('setup-error')!;
    errorEl.style.display = 'block';
    errorEl.style.background = 'rgba(0,255,136,0.08)';
    errorEl.style.borderColor = 'rgba(0,255,136,0.3)';
    errorEl.style.color = '#00ff88';
    errorEl.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 6px;">✓ API Keys Saved</div>
      <div style="font-size: 10px;">Features will be enabled based on your API key permissions</div>
    `;
    
    // Play success sound
    await playIfEnabled('success');
    
    // Wait a moment then navigate
    setTimeout(() => {
      // Clear inputs after saving
      (document.getElementById('input-mistral-key') as HTMLInputElement).value = '';
      (document.getElementById('input-elevenlabs') as HTMLInputElement).value = '';
      navigate('connect');
    }, 1500);
    
  } catch (error) {
    console.error('[Setup] Error saving keys:', error);
    showSetupError('Failed to save API keys. Please try again.');
    await playIfEnabled('error');
  }
}

function showCapabilityInfo(capabilities: any): void {
  const errorEl = document.getElementById('setup-error')!;
  errorEl.style.display = 'block';
  errorEl.style.background = 'rgba(0,255,136,0.08)';
  errorEl.style.borderColor = 'rgba(0,255,136,0.3)';
  errorEl.style.color = '#00ff88';
  
  const tierName = getTierDisplayName(capabilities.tier);
  const features = [];
  
  if (capabilities.hasVoiceLibrary) features.push('✓ Voice Library');
  if (capabilities.hasMultilingual) features.push('✓ Multilingual');
  if (capabilities.hasStreaming) features.push('✓ Streaming Audio');
  if (capabilities.hasVoiceCloning) features.push('✓ Voice Cloning');
  
  errorEl.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 6px;">✓ API Keys Validated</div>
    <div style="font-size: 10px; margin-bottom: 4px;">Plan: ${tierName}</div>
    <div style="font-size: 9px; line-height: 1.4;">${features.join(' • ')}</div>
  `;
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
    card.onclick = async () => {
      await playIfEnabled('click');
      navigate('detail', { proposal: p });
    };

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

    // All choices with votes
    if (p.scores_total > 0 && p.percentages.length > 0) {
      const pairs = p.choices
        .map((c, i) => ({ choice: c, percent: p.percentages[i] || 0, score: p.scores[i] || 0, origIdx: i }))
        .filter(item => item.choice);

      // Assign colors: highest % = green, second = red, rest = grey
      const sorted = [...pairs].sort((a, b) => b.percent - a.percent);
      const colorMap = new Map<number, string>();
      sorted.forEach((item, rank) => {
        colorMap.set(item.origIdx, rank === 0 ? 'green' : rank === 1 ? 'red' : 'grey');
      });

      pairs.forEach(({ choice, percent, score, origIdx }) => {
        const color = colorMap.get(origIdx) || 'grey';
        const row = document.createElement('div');
        row.className = 'choice-row';

        const label = document.createElement('span');
        label.className = `choice-label color-${color}`;
        label.textContent = choice;

        const right = document.createElement('span');
        right.className = 'choice-right';

        const pctSpan = document.createElement('span');
        pctSpan.className = `choice-pct color-${color}`;
        pctSpan.textContent = `${percent}%`;

        const vpSpan = document.createElement('span');
        vpSpan.className = 'vp-amount';
        vpSpan.textContent = formatVotingPower(score);

        right.appendChild(pctSpan);
        right.appendChild(vpSpan);

        const bar = document.createElement('div');
        bar.className = 'progress-bar';
        const fill = document.createElement('div');
        fill.className = `progress-fill fill-${color}`;
        fill.style.width = `${percent}%`;
        bar.appendChild(fill);

        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(right);
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

  // Summary header with badge and language selector
  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'summary-header';

  const summaryBadge = document.createElement('div');
  summaryBadge.className = 'summary-badge';
  summaryBadge.textContent = '⚡ AI SUMMARY';

  // Language selector
  const languageSelector = document.createElement('div');
  languageSelector.className = 'language-selector';
  
  const languageBtn = document.createElement('button');
  languageBtn.className = 'language-btn';
  languageBtn.id = 'language-btn';
  languageBtn.innerHTML = '<span id="current-lang-flag">🇬🇧</span> <span id="current-lang">EN</span> ▾';
  
  const languageDropdown = document.createElement('div');
  languageDropdown.className = 'language-dropdown';
  languageDropdown.id = 'language-dropdown';
  
  // Populate language options
  SUPPORTED_LANGUAGES.forEach(lang => {
    const option = document.createElement('div');
    option.className = 'language-option';
    option.dataset.code = lang.code;
    option.dataset.flag = lang.flag;
    option.innerHTML = `<span class="language-flag">${lang.flag}</span><span>${lang.name}</span>`;
    languageDropdown.appendChild(option);
  });
  
  languageSelector.appendChild(languageBtn);
  languageSelector.appendChild(languageDropdown);
  
  summaryHeader.appendChild(summaryBadge);
  summaryHeader.appendChild(languageSelector);

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

  summaryWrapper.appendChild(summaryHeader);
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
      .filter(item => item.choice);

    // Rank-based coloring: highest % = green, second = red, rest = grey
    const sorted = [...pairs].sort((a, b) => b.percent - a.percent);
    const colorMap = new Map<number, string>();
    sorted.forEach((item, rank) => {
      colorMap.set(item.idx, rank === 0 ? 'green' : rank === 1 ? 'red' : 'grey');
    });

    pairs.forEach(({ choice, percent, score, idx }) => {
      const color = colorMap.get(idx) || 'grey';

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

      const right = document.createElement('span');
      right.className = 'detail-choice-right';

      const pct = document.createElement('span');
      pct.className = `detail-choice-pct color-${color}`;
      pct.textContent = `${percent}%`;

      const vp = document.createElement('span');
      vp.className = 'vp-amount';
      vp.textContent = formatVotingPower(score);

      right.appendChild(pct);
      right.appendChild(vp);

      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(right);
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
      // Read dataset BEFORE any await — currentTarget becomes null after async
      const tab = (e.currentTarget as HTMLElement).dataset.tab!;
      await playIfEnabled('click');
      console.log('[Tab Click] tab:', tab, '| currentTab:', appState.activeTab);
      if (appState.activeTab === tab) return;
      appState.activeTab = tab;
      appState.proposals = [];
      appState.proposalsSkip = 0;
      appState.hasMoreProposals = true;
      lastFetchTime = 0;
      lastFetchedTab = '';
      updateActiveTabUI();
      await loadProposalsByTab();
      setupInfiniteScroll();
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
  if (isLoadingProposals) {
    console.log('[Load Proposals] Already loading, skipping...');
    return;
  }

  // Offline guard
  if (!navigator.onLine) {
    showProposalsError('You are offline. Please check your connection and try again.');
    return;
  }

  // Use cache if within TTL, not forced, initial load, AND same tab
  if (!forceReload && appState.proposalsSkip === 0 && lastFetchTime && lastFetchedTab === appState.activeTab && (Date.now() - lastFetchTime) < CACHE_TTL_MS) {
    if (appState.proposals.length > 0) {
      renderProposalsList(appState.proposals);
      return;
    }
  }

  isLoadingProposals = true;
  
  // Show appropriate loading indicator
  if (appState.proposalsSkip === 0) {
    // Initial load - show main loading screen
    showProposalsLoading();
  } else {
    // Pagination - show "loading more" at bottom
    const loadingMore = document.getElementById('proposals-loading-more');
    if (loadingMore) loadingMore.style.display = 'flex';
  }

  // Show loading spinner inside reload button
  const reloadBtn = document.getElementById('btn-reload-proposals');
  reloadBtn?.classList.add('loading');

  console.log('[Load Proposals] Fetching proposals...', {
    tab: appState.activeTab,
    skip: appState.proposalsSkip,
    currentCount: appState.proposals.length
  });

  try {
    let raw;
    if (appState.activeTab === 'all') {
      raw = await fetchAllActiveProposals(appState.proposalsSkip);
    } else {
      raw = await fetchDAOProposals(appState.activeTab, appState.proposalsSkip);
    }

    console.log('[Load Proposals] Fetched:', raw.length, 'proposals');

    const proposals = raw.map(transformProposal).filter(Boolean) as DisplayProposal[];
    
    // Check if there are more proposals (if we got less than expected, no more)
    const expectedBatchSize = 40;
    appState.hasMoreProposals = proposals.length >= expectedBatchSize;
    
    console.log('[Load Proposals] Has more proposals:', appState.hasMoreProposals);
    
    // Append to existing proposals if loading more, otherwise replace
    if (appState.proposalsSkip > 0) {
      appState.proposals = [...appState.proposals, ...proposals];
      console.log('[Load Proposals] Appended. Total now:', appState.proposals.length);
    } else {
      appState.proposals = proposals;
      console.log('[Load Proposals] Replaced. Total now:', appState.proposals.length);
    }
    
    lastFetchTime = Date.now();
    lastFetchedTab = appState.activeTab;
    updateLastUpdatedLabel();

    if (appState.proposals.length === 0) {
      showProposalsEmpty();
    } else {
      renderProposalsList(appState.proposals);
    }

    // Schedule next auto-reload
    if (autoReloadTimer) clearTimeout(autoReloadTimer);
    autoReloadTimer = window.setTimeout(() => {
      if (appState.screen === 'proposals') {
        appState.proposalsSkip = 0;
        loadProposalsByTab(true);
      }
    }, CACHE_TTL_MS);

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load proposals';
    showProposalsError(msg);
    console.error('[Load Proposals] Error:', err);
  } finally {
    isLoadingProposals = false;
    reloadBtn?.classList.remove('loading');
    
    // Hide "loading more" indicator
    const loadingMore = document.getElementById('proposals-loading-more');
    if (loadingMore) loadingMore.style.display = 'none';
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

async function loadAISummary(proposal: DisplayProposal, languageCode?: string): Promise<void> {
  resetSummarySection();
  const loadStart = Date.now();

  // Get language preference
  const language = languageCode || await getLanguagePreference();
  
  // Update language button display
  const currentLangEl = document.getElementById('current-lang');
  const currentFlagEl = document.getElementById('current-lang-flag');
  if (currentLangEl) {
    currentLangEl.textContent = language.toUpperCase();
  }
  if (currentFlagEl) {
    const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === language);
    if (selectedLang) {
      currentFlagEl.textContent = selectedLang.flag;
    }
  }

  // Check Mistral API key
  const apiKey = await getMistralApiKey();

  if (!apiKey) {
    await holdMinLoader(loadStart);
    showSummaryNoKey();
    return;
  }

  // Check cache with language
  let summary = await getCachedSummary(proposal.id, language);

  if (!summary) {
    try {
      summary = await generateSummary(proposal.bodyFull, apiKey, language);
      await cacheSummary(proposal.id, summary, language);
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
    await playIfEnabled('error');
    return;
  }

  // Confirmation dialog
  const choiceName = proposal.choices[choiceIndex - 1] || `Choice ${choiceIndex}`;
  const confirmed  = window.confirm(`Vote "${choiceName}" on:\n"${proposal.title}"?`);
  if (!confirmed) {
    await playIfEnabled('click');
    return;
  }

  // Disable buttons + show loading
  setVoteButtons(buttonsContainer, true);
  statusEl.textContent = 'Opening signing tab...';
  statusEl.className   = 'vote-status loading';

  try {
    await castVote(proposal.id, proposal.spaceId, choiceIndex, address);
    statusEl.textContent = 'Vote submitted successfully ✅';
    statusEl.className   = 'vote-status success';
    await playIfEnabled('vote-cast');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Vote failed. Please try again.';

    if (msg.includes('already voted')) {
      statusEl.textContent = 'You have already voted on this proposal';
      statusEl.className   = 'vote-status error';
      await playIfEnabled('warning');
      // Keep buttons disabled
    } else if (msg === 'Signature rejected') {
      statusEl.textContent = 'Signature rejected';
      statusEl.className   = 'vote-status error';
      await playIfEnabled('error');
      setVoteButtons(buttonsContainer, false);
    } else {
      statusEl.textContent = 'Vote failed. Please try again.';
      statusEl.className   = 'vote-status error';
      await playIfEnabled('error');
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
const WAKE_WORD = 'hey'; // Simple wake word - just "hey"

// Voice settings modal state
let availableVoices: any[] = [];
let isVoiceSettingsOpen = false;

function startWakeWordListener(): void {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  if (wakeWordRecognition) return; // already running

  wakeWordRecognition = new SpeechRecognition();
  wakeWordRecognition.continuous     = true;
  wakeWordRecognition.interimResults = true;
  wakeWordRecognition.lang           = 'en-US';
  wakeWordRecognition.maxAlternatives = 3; // Get multiple alternatives for better detection

  wakeWordRecognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      
      // Check all alternatives for better detection
      for (let j = 0; j < result.length; j++) {
        const text = result[j].transcript.toLowerCase().trim();
        console.log('[Wake Word] Heard (alternative ' + j + '):', text, 'confidence:', result[j].confidence);
        
        // Check for "hey" - simple and reliable wake word
        // Matches: "hey", "hay", "a", "eh"
        const heyVariants = [
          'hey',
          'hay', 
          'a',
          'eh',
          'hey.',
          'hey,',
          'hey!'
        ];
        
        // Check for "hey" variants - only works when idle
        const hasWakeWord = heyVariants.some(variant => text === variant || text.startsWith(variant + ' '));
        if (hasWakeWord && voiceState === 'idle') {
          console.log('[Wake Word] Wake word "hey" detected! Triggering Ask AI...');
          // Just trigger the button click - same as manual click
          handleVoiceButtonClick();
          return;
        }
      }
    }
  };

  wakeWordRecognition.onend = () => {
    // Auto-restart if still on detail screen
    if (appState.screen === 'detail' && wakeWordRecognition) {
      try { 
        wakeWordRecognition.start(); 
        // Reduced logging - only log on first start, not on every restart
      } catch (e) {
        // Silently fail - this is expected if recognition is already running
      }
    }
  };

  wakeWordRecognition.onerror = (e: any) => {
    console.log('[Wake Word] Error:', e.error);
    
    // Silently handle common errors that are expected during continuous listening
    if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'audio-capture') {
      // These are normal during continuous listening - don't log or restart immediately
      // The onend handler will restart the listener automatically
      return;
    }
    
    // For other errors, log and clear the recognition object
    console.error('[Wake Word] Unexpected error:', e.error);
    wakeWordRecognition = null;
  };

  try {
    wakeWordRecognition.start();
    console.log('[Wake Word] Listener started');
    // Update status hint
    const statusEl = document.getElementById('voice-status');
    if (statusEl && voiceState === 'idle') {
      statusEl.textContent = 'Say "Hey" to start or click Ask AI';
    }
  } catch (e) {
    console.log('[Wake Word] Failed to start:', e);
    wakeWordRecognition = null;
  }
}

function stopWakeWordListener(): void {
  if (wakeWordRecognition) {
    try { wakeWordRecognition.stop(); } catch {}
    wakeWordRecognition = null;
  }
}

// ============================================
// Voice Settings Modal
// ============================================

async function openVoiceSettings(): Promise<void> {
  if (isVoiceSettingsOpen) return;
  isVoiceSettingsOpen = true;

  const modal = document.getElementById('voice-settings-modal');
  if (!modal) return;

  // Get current settings and capabilities
  const settings = await getVoiceSettings();
  const capabilities = await getCapabilities();
  const elevenKey = await getElevenLabsApiKey();

  console.log('[Voice Settings] Opening voice settings...');

  // Try to fetch available voices
  if (elevenKey) {
    try {
      availableVoices = await fetchAvailableVoices(elevenKey);
      console.log('[Voice Settings] Fetched voices:', availableVoices.length);
    } catch (error) {
      console.error('[Voice Settings] Failed to fetch voices:', error);
      availableVoices = [];
      
      // Show error message in voice selector
      const upgradeHint = document.getElementById('voice-upgrade-hint');
      if (upgradeHint) {
        upgradeHint.style.display = 'block';
        upgradeHint.innerHTML = `
          <span style="color: #EF0606;">⚠ Could not load voice library</span><br>
          <span style="font-size: 9px;">Your API key may not have "Voices: Read" permission enabled. 
          <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" class="upgrade-link">Enable it here</a></span>
        `;
      }
    }
  }

  // Populate voice selector
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  if (voiceSelect) {
    voiceSelect.innerHTML = '';
    
    if (capabilities.hasVoiceLibrary && availableVoices.length > 0) {
      // Group voices by category
      const categories = new Map<string, any[]>();
      availableVoices.forEach(voice => {
        const category = voice.category || 'Other';
        if (!categories.has(category)) {
          categories.set(category, []);
        }
        categories.get(category)!.push(voice);
      });

      // Add voices by category
      categories.forEach((voices, category) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        voices.forEach(voice => {
          const option = document.createElement('option');
          option.value = voice.voice_id;
          option.textContent = voice.name;
          if (voice.voice_id === settings.selectedVoiceId) {
            option.selected = true;
          }
          optgroup.appendChild(option);
        });
        voiceSelect.appendChild(optgroup);
      });
      voiceSelect.disabled = false;
    } else {
      // Free tier - show default voice only
      const option = document.createElement('option');
      option.value = settings.selectedVoiceId;
      option.textContent = settings.voiceName;
      option.selected = true;
      voiceSelect.appendChild(option);
      voiceSelect.disabled = true;
      
      // Show upgrade hint
      const upgradeHint = document.getElementById('voice-upgrade-hint');
      if (upgradeHint) {
        upgradeHint.style.display = 'block';
      }
    }
  }

  // Set speech speed slider
  const speedSlider = document.getElementById('voice-speed-slider') as HTMLInputElement;
  const speedValue = document.getElementById('voice-speed-value');
  if (speedSlider && speedValue) {
    speedSlider.value = settings.speechSpeed.toString();
    speedValue.textContent = `${settings.speechSpeed.toFixed(1)}x`;
    
    speedSlider.oninput = () => {
      speedValue.textContent = `${parseFloat(speedSlider.value).toFixed(1)}x`;
    };
  }

  // Set sound effects toggle
  const soundToggle = document.getElementById('sound-effects-toggle');
  const soundSwitch = document.getElementById('sound-toggle-switch');
  if (soundToggle && soundSwitch) {
    if (settings.soundEffectsEnabled) {
      soundSwitch.classList.add('active');
    } else {
      soundSwitch.classList.remove('active');
    }
  }

  // Show modal
  modal.classList.add('show');
  await playIfEnabled('open');
}

async function closeVoiceSettings(): Promise<void> {
  const modal = document.getElementById('voice-settings-modal');
  if (!modal) return;

  modal.classList.remove('show');
  isVoiceSettingsOpen = false;
  await playIfEnabled('close');
}

async function saveVoiceSettingsFromModal(): Promise<void> {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  const speedSlider = document.getElementById('voice-speed-slider') as HTMLInputElement;
  const soundSwitch = document.getElementById('sound-toggle-switch');

  if (!voiceSelect || !speedSlider || !soundSwitch) return;

  // Get selected voice name
  const selectedOption = voiceSelect.options[voiceSelect.selectedIndex];
  const voiceName = selectedOption?.textContent || 'Sarah';

  // Save settings
  await saveVoiceSettings({
    selectedVoiceId: voiceSelect.value,
    voiceName: voiceName,
    speechSpeed: parseFloat(speedSlider.value),
    soundEffectsEnabled: soundSwitch.classList.contains('active')
  });

  await playIfEnabled('success');
  await closeVoiceSettings();
}

/** Play a short chime using Web Audio API — no external files needed */
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
      statusEl.textContent = 'Say "Hey" to start or click Ask AI';
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
  await playIfEnabled('mic-start');

  const { promise, stop } = recordWithSpeechAPI(
    (interim, _isFinal) => {
      if (interim) showVoiceTranscript(interim);
    },
    3000  // 3 seconds of silence before stopping (reduced for better responsiveness)
  );
  stopRecording = stop;

  let transcript: string;
  try {
    transcript = await promise;
  } catch (err: any) {
    console.error('[Voice] Recording failed:', err);
    // Don't show error if it's just "no speech" - user might have changed their mind
    if (err?.message && err.message.includes('No speech detected')) {
      console.log('[Voice] No speech detected, returning to idle');
      setVoiceState('idle');
      return;
    }
    showVoiceError(err?.message || 'Microphone access denied or unavailable.');
    await playIfEnabled('error');
    return;
  } finally {
    stopRecording = null;
    await playIfEnabled('mic-stop');
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
    console.log('[Voice] AI response received, length:', answer.length);
  } catch (err: any) {
    console.error('[Voice] Mistral failed:', err);
    showVoiceError('AI response failed. Try again.');
    await playIfEnabled('error');
    return;
  }

  // Step 3: Detect language from AI response (not from user's dropdown)
  const detectedLanguage = detectLanguage(answer);
  console.log('[Voice] Detected language from AI response:', detectedLanguage);
  console.log('[Voice] AI response preview:', answer.substring(0, 100) + '...');
  console.log('[Voice] ===== FULL TEXT BEING SENT TO TTS =====');
  console.log('[Voice] Text:', answer);
  console.log('[Voice] Text length:', answer.length, 'characters');
  console.log('[Voice] ==========================================');

  // Step 4: TTS — speak the clean plain-text answer with native accent
  try {
    // Get user's voice settings
    const settings = await getVoiceSettings();
    
    console.log('[Voice] Starting TTS with language:', detectedLanguage, 'voice:', settings.selectedVoiceId);
    
    // Use detected language for native accent, not user's dropdown selection
    await speakTextStream(
      answer, 
      elevenKey, 
      settings.selectedVoiceId, 
      detectedLanguage,
      () => {
        // Callback when audio is ready to play
        console.log('[Voice] Audio ready, changing state to speaking');
        setVoiceState('speaking');
      }
    );
    
    console.log('[Voice] TTS completed successfully');
  } catch (err: any) {
    console.error('[Voice] TTS failed:', err);
    console.error('[Voice] TTS error details:', {
      message: err?.message,
      stack: err?.stack,
      detectedLanguage,
      answerLength: answer?.length
    });
    // Show the actual error message from TTS (which includes helpful hints)
    showVoiceError(err?.message || 'Could not play audio response.');
    await playIfEnabled('error');
    return;
  }

  setVoiceState('idle');
}

// ============================================
// Theme System
// ============================================

async function initializeTheme(): Promise<void> {
  const savedTheme = await getTheme();
  applyTheme(savedTheme);
  updateThemeButtonIcon(savedTheme);

  const dropdown = document.getElementById('theme-dropdown');
  if (dropdown) {
    dropdown.innerHTML = '';
    THEMES.forEach(theme => {
      const option = document.createElement('div');
      option.className = 'theme-option';
      if (theme.name === savedTheme) option.classList.add('selected');
      option.dataset.theme = theme.name;
      option.innerHTML = `
        <img class="theme-option-icon" src="${theme.icon}" alt="${theme.displayName}" style="width:20px;height:20px;object-fit:contain;border-radius:4px;">
        <span class="theme-option-name">${theme.displayName}</span>
      `;
      dropdown.appendChild(option);
    });
  }

  const themeBtn = document.getElementById('btn-theme');
  const themeDropdown = document.getElementById('theme-dropdown');

  if (themeBtn && themeDropdown) {
    themeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      themeDropdown.classList.toggle('show');
      if (themeDropdown.classList.contains('show')) {
        await playIfEnabled('click');
      }
    });

    themeDropdown.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const option = target.closest('.theme-option') as HTMLElement;
      if (option && option.dataset.theme) {
        const themeName = option.dataset.theme as ThemeName;
        await saveTheme(themeName);
        applyTheme(themeName);
        updateThemeButtonIcon(themeName);
        themeDropdown.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        themeDropdown.classList.remove('show');
        await playIfEnabled('success');
        broadcastThemeChange(themeName);
      }
    });

    document.addEventListener('click', () => {
      if (themeDropdown.classList.contains('show')) {
        themeDropdown.classList.remove('show');
      }
    });
  }
}

function updateThemeButtonIcon(theme: ThemeName): void {
  const themeBtn = document.getElementById('btn-theme');
  if (themeBtn) {
    const themeData = THEMES.find(t => t.name === theme);
    if (themeData) {
      themeBtn.innerHTML = `<img src="${themeData.icon}" alt="${themeData.displayName}" style="width:18px;height:18px;object-fit:contain;border-radius:3px;">`;
    }
  }
}

function broadcastThemeChange(theme: ThemeName): void {
  // Send message to all tabs to update theme
  chrome.runtime.sendMessage({
    type: 'THEME_CHANGED',
    theme: theme
  }).catch(() => {
    // Ignore errors if no listeners
  });
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
  connectBtn.addEventListener('click', async () => {
    await playIfEnabled('click');
    connectWallet();
  });
  document.getElementById('retry-btn')!.addEventListener('click', async () => {
    await playIfEnabled('click');
    connectWallet();
  });
  changeWalletBtn.addEventListener('click', async () => {
    await playIfEnabled('click');
    changeWallet();
  });
  cancelBtn.addEventListener('click', async () => {
    await playIfEnabled('click');
    isConnecting = false;
    showState('disconnected');
  });
  disconnectBtn.addEventListener('click', async () => {
    await playIfEnabled('click');
    disconnectWallet();
  });

  // Feature 2 button wiring
  document.getElementById('btn-proposals')!.addEventListener('click', async () => {
    await playIfEnabled('click');
    appState.activeTab = 'all';
    appState.proposalsSkip = 0;
    appState.hasMoreProposals = true;
    navigate('proposals');
    updateActiveTabUI();
    await loadProposalsByTab();
    setupInfiniteScroll();
  });

  document.getElementById('btn-back-proposals')!.addEventListener('click', async () => {
    await playIfEnabled('click');
    navigate('connected');
  });

  document.getElementById('btn-back-detail')!.addEventListener('click', async () => {
    await playIfEnabled('click');
    stopSpeaking();
    stopWakeWordListener();
    resetConversation();
    navigate('proposals');
    // Use cached proposals — no re-fetch, preserve active tab
    if (appState.proposals.length > 0) {
      renderProposalsList(appState.proposals);
    }
  });

  document.getElementById('btn-reload-proposals')!.addEventListener('click', async () => {
    await playIfEnabled('click');
    lastFetchTime = 0; // force reload
    appState.proposalsSkip = 0;
    appState.hasMoreProposals = true;
    loadProposalsByTab(true);
  });

  document.getElementById('btn-retry')!.addEventListener('click', async () => {
    await playIfEnabled('click');
    loadProposalsByTab();
  });

  // Feature 4: Voice AI button
  document.getElementById('btn-voice')!.addEventListener('click', handleVoiceButtonClick);

  // Voice settings button
  document.getElementById('btn-voice-settings')!.addEventListener('click', openVoiceSettings);
  document.getElementById('btn-close-voice-settings')!.addEventListener('click', closeVoiceSettings);
  document.getElementById('btn-save-voice-settings')!.addEventListener('click', saveVoiceSettingsFromModal);

  // Sound effects toggle
  document.getElementById('sound-effects-toggle')!.addEventListener('click', async () => {
    const soundSwitch = document.getElementById('sound-toggle-switch');
    if (soundSwitch) {
      soundSwitch.classList.toggle('active');
      await playIfEnabled('click');
    }
  });

  // Close modal when clicking outside
  document.getElementById('voice-settings-modal')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeVoiceSettings();
    }
  });

  // Language selector event listeners
  document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    
    // Toggle dropdown
    if (target.closest('#language-btn')) {
      const dropdown = document.getElementById('language-dropdown');
      if (dropdown) {
        dropdown.classList.toggle('show');
        await playIfEnabled(dropdown.classList.contains('show') ? 'open' : 'close');
      }
      e.stopPropagation();
      return;
    }
    
    // Select language
    if (target.closest('.language-option')) {
      const option = target.closest('.language-option') as HTMLElement;
      const code = option.dataset.code;
      const flag = option.dataset.flag;
      if (code && appState.selectedProposal) {
        await playIfEnabled('click');
        
        // Save preference
        await saveLanguagePreference(code);
        
        // Update UI
        const currentLangEl = document.getElementById('current-lang');
        const currentFlagEl = document.getElementById('current-lang-flag');
        if (currentLangEl) {
          currentLangEl.textContent = code.toUpperCase();
        }
        if (currentFlagEl && flag) {
          currentFlagEl.textContent = flag;
        }
        
        // Update selected state
        document.querySelectorAll('.language-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        option.classList.add('selected');
        
        // Close dropdown
        const dropdown = document.getElementById('language-dropdown');
        if (dropdown) {
          dropdown.classList.remove('show');
        }
        
        // Reload summary in new language
        await loadAISummary(appState.selectedProposal, code);
      }
      e.stopPropagation();
      return;
    }
    
    // Close dropdown when clicking outside
    const dropdown = document.getElementById('language-dropdown');
    if (dropdown && dropdown.classList.contains('show')) {
      dropdown.classList.remove('show');
      await playIfEnabled('close');
    }
  });

  // Bind tab click events
  bindTabEvents();

  // Initialize theme system
  await initializeTheme();

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

// ============================================
// Infinite Scroll for Proposals
// ============================================

function setupInfiniteScroll(): void {
  const proposalsList = document.getElementById('proposals-list');
  if (!proposalsList) {
    console.warn('[Infinite Scroll] proposals-list element not found');
    return;
  }

  console.log('[Infinite Scroll] Setting up scroll listener on proposals-list');
  
  // Remove existing listener if any
  proposalsList.removeEventListener('scroll', handleProposalsScroll);
  
  // Add scroll listener to the actual scrollable container
  proposalsList.addEventListener('scroll', handleProposalsScroll);
  
  console.log('[Infinite Scroll] Scroll listener attached successfully');
}

async function handleProposalsScroll(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  
  const scrollHeight = target.scrollHeight;
  const scrollTop = target.scrollTop;
  const clientHeight = target.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  
  console.log('[Infinite Scroll] Scroll detected:', {
    scrollHeight,
    scrollTop,
    clientHeight,
    distanceFromBottom,
    isLoading: isLoadingProposals,
    hasMore: appState.hasMoreProposals,
    currentSkip: appState.proposalsSkip
  });
  
  // Check if scrolled near bottom (within 200px)
  const scrolledToBottom = distanceFromBottom < 200;
  
  if (scrolledToBottom && !isLoadingProposals && appState.hasMoreProposals) {
    console.log('[Infinite Scroll] Loading more proposals...');
    
    // Increment skip to load next batch (always 40 for consistency)
    appState.proposalsSkip += 40;
    
    await loadProposalsByTab();
  }
}
