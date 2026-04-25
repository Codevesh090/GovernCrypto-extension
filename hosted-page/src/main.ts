/**
 * Hosted Web3Modal page for wallet connection
 * Recreates modal fresh on every click to prevent cached session card
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
  url: 'http://localhost:3000',
  icons: ['https://governcrypto.xyz/logo.png']
}

// UI Elements
const connectButton = document.getElementById('connect-btn') as HTMLButtonElement

let addressSent = false

function sendToExtension(address: string) {
  if (addressSent) return
  addressSent = true

  console.log('[GC] Sending address:', address)

  try {
    localStorage.setItem('gc_wallet_address', address)
    localStorage.setItem('gc_wallet_ts', Date.now().toString())
  } catch (_) {}

  try {
    window.dispatchEvent(new CustomEvent('gc_wallet_connected', { detail: { address } }))
  } catch (_) {}

  if (window.opener) {
    try {
      window.opener.postMessage({ type: 'WALLET_CONNECTED', address }, '*')
    } catch (_) {}
  }

  setTimeout(() => window.close(), 1500)
}

function clearWalletCache() {
  // Clear all WalletConnect/Web3Modal storage
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

// Button click — create a FRESH modal every time, no cached state
async function connectWallet() {
  console.log('[GC] Connect clicked - creating fresh modal')
  addressSent = false
  connectButton.disabled = true

  // Clear all cached sessions first
  clearWalletCache()

  // Small wait for cache clear to complete
  await new Promise(r => setTimeout(r, 200))

  // Create a brand new modal instance (no cached state)
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

  // Subscribe to connection on this fresh modal
  modal.subscribeProvider(async ({ provider, address, isConnected }) => {
    console.log('[GC] Provider update:', { address, isConnected })

    if (isConnected && address) {
      sendToExtension(address)
      return
    }

    if (isConnected && provider && !address) {
      try {
        const ethersProvider = new BrowserProvider(provider)
        const accounts = await ethersProvider.send('eth_requestAccounts', [])
        if (accounts[0]) {
          sendToExtension(accounts[0])
        }
      } catch (err) {
        console.error('[GC] Failed to get accounts:', err)
      }
    }
  })

  // Open directly to Connect view
  modal.open({ view: 'Connect' })

  // Re-enable button after short delay
  setTimeout(() => { connectButton.disabled = false }, 1000)
}

function init() {
  console.log('[GC] Page loaded')
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
