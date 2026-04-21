// Popup script - Main entry point for extension UI
import { WalletStorage, truncateAddress } from './storage.js';

console.log('Snapshot Governance Extension - Popup loaded');

const HOSTED_PAGE_URL = 'http://localhost:3000';
const TRUSTED_ORIGIN = 'http://localhost:3000';

const storage = new WalletStorage();
let isConnecting = false;

// UI Elements (grabbed after DOM loads)
let disconnectedState: HTMLElement;
let connectingState: HTMLElement;
let connectedState: HTMLElement;
let errorState: HTMLElement;
let connectBtn: HTMLButtonElement;
let cancelBtn: HTMLButtonElement;
let disconnectBtn: HTMLButtonElement;
let changeWalletBtn: HTMLButtonElement;
let retryBtn: HTMLButtonElement;
let walletAddressEl: HTMLElement;
let errorTextEl: HTMLElement;

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

  // Only accept messages from trusted origin
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
  // Clear stored address and open hosted page to pick a new wallet
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
  showState('disconnected');
}

async function initialize() {
  // Grab DOM elements
  disconnectedState = document.getElementById('disconnected-state')!;
  connectingState   = document.getElementById('connecting-state')!;
  connectedState    = document.getElementById('connected-state')!;
  errorState        = document.getElementById('error-state')!;
  connectBtn        = document.getElementById('connect-btn') as HTMLButtonElement;
  cancelBtn         = document.getElementById('cancel-btn') as HTMLButtonElement;
  disconnectBtn     = document.getElementById('disconnect-btn') as HTMLButtonElement;
  changeWalletBtn   = document.getElementById('change-wallet-btn') as HTMLButtonElement;
  retryBtn          = document.getElementById('retry-btn') as HTMLButtonElement;
  walletAddressEl   = document.getElementById('wallet-address')!;
  errorTextEl       = document.getElementById('error-text')!;

  // Wire up buttons
  connectBtn.addEventListener('click', connectWallet);
  retryBtn.addEventListener('click', connectWallet);
  changeWalletBtn.addEventListener('click', changeWallet);
  cancelBtn.addEventListener('click', () => {
    isConnecting = false;
    showState('disconnected');
  });
  disconnectBtn.addEventListener('click', disconnectWallet);

  // Check for existing connection
  const result = await chrome.storage.local.get('connectedAddress');
  if (result.connectedAddress) {
    showConnected(result.connectedAddress);
  } else {
    showState('disconnected');
  }
}

document.addEventListener('DOMContentLoaded', initialize);
