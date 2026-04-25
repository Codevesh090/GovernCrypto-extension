/**
 * Hosted Web3Modal page for wallet connection
 * Modal created once on load for instant open, session cleared on every click
 */

import { createWeb3Modal, defaultConfig } from '@web3modal/ethers'
import { BrowserProvider } from 'ethers'

const PROJECT_ID = 'd34e919498204940293ed0ae298c7bc0'

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
  url: 'https://governcrypto.xyz',
  icons: ['https://governcrypto.xyz/logo.png']
}

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

// Clear cached sessions on page load before creating modal
function clearWalletCache() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('wc@') || k.startsWith('W3M') || k.startsWith('@w3m') ||
        k.includes('walletconnect') || k.includes('web3modal'))) {
        keys.push(k)
      }
    }
    keys.forEach(k => localStorage.removeItem(k))
  } catch (_) {}
  try { sessionStorage.clear() } catch (_) {}
  try {
    ['WALLET_CONNECT_V2_INDEXED_DB', 'w3m', 'wc', 'wagmi'].forEach(db => {
      try { indexedDB.deleteDatabase(db) } catch (_) {}
    })
  } catch (_) {}
}

// Clear on page load
clearWalletCache()

// Create modal ONCE on page load — instant open on button click
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

// Disconnect any auto-restored session immediately after creation
modal.disconnect().catch(() => {})

// UI Elements
const connectButton = document.getElementById('connect-btn') as HTMLButtonElement

let addressSent = false

function sendToExtension(address: string) {
  if (addressSent) return
  // Validate address format
  if (!ETH_ADDRESS_REGEX.test(address)) return
  addressSent = true

  try {
    localStorage.setItem('gc_wallet_address', address)
    localStorage.setItem('gc_wallet_ts', Date.now().toString())
  } catch (_) {}

  try {
    window.dispatchEvent(new CustomEvent('gc_wallet_connected', { detail: { address } }))
  } catch (_) {}

  if (window.opener) {
    try {
      window.opener.postMessage({ type: 'WALLET_CONNECTED', address }, 'https://governcrypto.xyz')
    } catch (_) {}
  }

  setTimeout(() => window.close(), 1500)
}

// Subscribe to provider — only act after user clicks
let userInitiated = false

modal.subscribeProvider(async ({ provider, address, isConnected }) => {
  if (!userInitiated) return

  if (isConnected && address) {
    sendToExtension(address)
    return
  }

  if (isConnected && provider && !address) {
    try {
      const ethersProvider = new BrowserProvider(provider)
      const accounts = await ethersProvider.send('eth_requestAccounts', [])
      if (accounts[0]) sendToExtension(accounts[0])
    } catch (_) {}
  }
})

// Button click — disconnect stale session then open instantly
async function connectWallet() {
  userInitiated = false
  connectButton.disabled = true

  // Disconnect any stale session
  try { await modal.disconnect() } catch (_) {}

  userInitiated = true

  // Open immediately — modal already initialized, opens instantly
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
