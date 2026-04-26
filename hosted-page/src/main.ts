/**
 * Hosted Web3Modal page for wallet connection
 * 
 * PRIMARY channel: localStorage → content script → chrome.runtime.sendMessage
 * NO window.opener.postMessage — removed completely
 */

import { createWeb3Modal, defaultConfig } from '@web3modal/ethers'
import { BrowserProvider } from 'ethers'

const PROJECT_ID = 'd34e919498204940293ed0ae298c7bc0'
const STORAGE_KEY = 'governcrypto_wallet'
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

const chains = [
  {
    chainId: 1,
    name: 'Ethereum',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    rpcUrl: 'https://cloudflare-eth.com'
  }
]

const metadata = {
  name: 'GovernCrypto',
  description: 'Connect your wallet to participate in DAO governance',
  url: 'https://governcrypto.xyz/connectwallet',
  icons: ['https://governcrypto.xyz/logo.png']
}

// Clear any stale wallet data on page load
function clearStaleData() {
  try { localStorage.removeItem(STORAGE_KEY) } catch (_) {}
  try { sessionStorage.clear() } catch (_) {}
}

clearStaleData()

// Create modal once on page load for instant open
const config = defaultConfig({
  metadata,
  enableEIP6963: true,
  enableInjected: true,
  enableCoinbase: true,
  rpcUrl: 'https://cloudflare-eth.com',
  defaultChainId: 1
})

const modal = createWeb3Modal({
  ethersConfig: config,
  chains,
  projectId: PROJECT_ID,
  enableAnalytics: false
})

// Disconnect any auto-restored session
modal.disconnect().catch(() => {})

// UI Elements
const connectButton = document.getElementById('connect-btn') as HTMLButtonElement

let addressSent = false
let userInitiated = false

function saveWalletToStorage(address: string): void {
  if (addressSent) return
  if (!ETH_ADDRESS_REGEX.test(address)) return
  addressSent = true

  // Save to localStorage — content script will pick this up
  try {
    const walletData = JSON.stringify({ address, timestamp: Date.now() })
    localStorage.setItem(STORAGE_KEY, walletData)
  } catch (_) {}

  // Tab will be closed by content script after it reads the data
  // Fallback: close after 2 seconds if content script doesn't close it
  setTimeout(() => window.close(), 2000)
}

// Subscribe to provider changes — only act after user clicks
modal.subscribeProvider(async ({ provider, address, isConnected }) => {
  if (!userInitiated) return

  if (isConnected && address) {
    saveWalletToStorage(address)
    return
  }

  if (isConnected && provider && !address) {
    try {
      const ethersProvider = new BrowserProvider(provider)
      const accounts = await ethersProvider.send('eth_requestAccounts', [])
      if (accounts[0]) saveWalletToStorage(accounts[0])
    } catch (_) {}
  }
})

// Button click — disconnect stale session then open wallet picker
async function connectWallet() {
  userInitiated = false
  connectButton.disabled = true

  // Clear stale data and disconnect
  clearStaleData()
  try { await modal.disconnect() } catch (_) {}

  userInitiated = true

  // Open wallet picker instantly
  modal.open({ view: 'Connect' })

  setTimeout(() => { connectButton.disabled = false }, 800)
}

function init() {
  connectButton.addEventListener('click', connectWallet)
  loadTheme()
}

async function loadTheme() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get('selectedTheme')
      applyTheme(result.selectedTheme || 'dark')
    } else {
      applyTheme('dark')
    }
  } catch (_) {
    applyTheme('dark')
  }
}

function applyTheme(theme: string) {
  document.body.className = `theme-${theme}`
}

try {
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message.type === 'THEME_CHANGED') applyTheme(message.theme)
    })
  }
} catch (_) {}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

export {}
