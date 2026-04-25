/**
 * Hosted Web3Modal page for wallet connection
 * WalletConnect-only implementation (no fallbacks)
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

// UI Elements
const connectButton = document.getElementById('connect-btn') as HTMLButtonElement
const statusDiv = document.getElementById('status') as HTMLElement
const statusText = document.getElementById('status-text') as HTMLElement

// Flags
let addressSent = false
let userInitiated = false

function updateStatus(message: string, type: 'connecting' | 'success' | 'error' = 'connecting') {
  statusDiv.className = `status ${type}`
  statusText.innerHTML = type === 'connecting'
    ? `<span class="loading-spinner"></span> ${message}`
    : message
  statusDiv.classList.remove('hidden')
}

function sendToExtension(address: string) {
  if (addressSent) return
  addressSent = true

  console.log('[GovernCrypto] Sending address to extension:', address)

  // Write to localStorage — content script will bridge to chrome.storage
  try {
    localStorage.setItem('gc_wallet_address', address)
    localStorage.setItem('gc_wallet_ts', Date.now().toString())
    console.log('[GovernCrypto] Saved to localStorage')
  } catch (err) {
    console.error('[GovernCrypto] localStorage error:', err)
  }

  // Dispatch custom event for content script
  try {
    window.dispatchEvent(new CustomEvent('gc_wallet_connected', { detail: { address } }))
    console.log('[GovernCrypto] Dispatched custom event')
  } catch (err) {
    console.error('[GovernCrypto] Event dispatch error:', err)
  }

  // Try postMessage to opener
  if (window.opener) {
    try {
      window.opener.postMessage({ type: 'WALLET_CONNECTED', address }, '*')
      console.log('[GovernCrypto] Sent postMessage to opener')
    } catch (err) {
      console.error('[GovernCrypto] postMessage error:', err)
    }
  }

  updateStatus('Connected! You can close this tab.', 'success')
  setTimeout(() => window.close(), 1500)
}


// Subscribe to provider changes
modal.subscribeProvider(async ({ provider, address, isConnected }) => {
  console.log('[GovernCrypto] Provider update:', { address, isConnected, userInitiated })

  // Ignore cached sessions on page load
  if (!userInitiated) {
    console.log('[GovernCrypto] Ignoring cached session')
    return
  }

  if (isConnected && address) {
    console.log('[GovernCrypto] Wallet connected with address:', address)
    updateStatus('Connected! Sending to extension...', 'success')
    sendToExtension(address)
    return
  }

  // Provider exists but address not yet available
  if (isConnected && provider && !address) {
    try {
      console.log('[GovernCrypto] Fetching address from provider...')
      const ethersProvider = new BrowserProvider(provider)
      const accounts = await ethersProvider.send('eth_requestAccounts', [])
      const fetchedAddress = accounts[0]
      if (fetchedAddress) {
        console.log('[GovernCrypto] Fetched address:', fetchedAddress)
        updateStatus('Connected! Sending to extension...', 'success')
        sendToExtension(fetchedAddress)
      }
    } catch (err) {
      console.error('[GovernCrypto] Failed to fetch accounts:', err)
      updateStatus('Failed to get wallet address', 'error')
    }
  }
})

async function connectWallet() {
  console.log('[GovernCrypto] Connect button clicked')
  addressSent = false
  userInitiated = true
  connectButton.disabled = true
  updateStatus('Opening WalletConnect...', 'connecting')

  try {
    console.log('[GovernCrypto] Opening Web3Modal...')
    await modal.open()
  } catch (error) {
    console.error('[GovernCrypto] Web3Modal error:', error)
    updateStatus('Failed to open wallet selection', 'error')
    connectButton.disabled = false
  }

  // Re-enable button after modal closes (user may dismiss without connecting)
  connectButton.disabled = false
}

window.addEventListener('load', () => {
  console.log('[GovernCrypto] Hosted page loaded')
  console.log('[GovernCrypto] Project ID:', PROJECT_ID)
  console.log('[GovernCrypto] Origin:', window.location.origin)
  connectButton.addEventListener('click', connectWallet)
  statusDiv.classList.add('hidden')
  loadTheme()
})

// Theme support
async function loadTheme() {
  try {
    const result = await chrome.storage.local.get('selectedTheme')
    const theme = result.selectedTheme || 'dark'
    applyTheme(theme)
  } catch (err) {
    console.log('[GovernCrypto] Could not load theme (not in extension context)')
  }
}

function applyTheme(theme: string) {
  document.body.classList.remove('theme-dark', 'theme-midnight', 'theme-ocean', 'theme-light', 'theme-pastel')
  document.body.classList.add(`theme-${theme}`)
}

// Listen for theme changes
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'THEME_CHANGED') {
      applyTheme(message.theme)
    }
  })
}

export {}
