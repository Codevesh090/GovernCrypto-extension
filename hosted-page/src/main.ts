/**
 * Hosted Web3Modal page for wallet connection
 * Uses subscribeProvider to detect actual wallet connection
 */

import { createWeb3Modal, defaultConfig } from '@web3modal/ethers'
import { BrowserProvider } from 'ethers'

const PROJECT_ID = 'YOUR_WALLETCONNECT_PROJECT_ID'

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
  name: 'Snapshot Governance Voting',
  description: 'Connect your wallet to participate in governance',
  url: window.location.origin,
  icons: ['https://avatars.githubusercontent.com/u/37784886']
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
let addressSent = false    // prevent duplicate sends
let userInitiated = false  // only react to provider after user clicks connect

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

  // Write to localStorage — content script will bridge to chrome.storage
  try {
    localStorage.setItem('gc_wallet_address', address)
    localStorage.setItem('gc_wallet_ts', Date.now().toString())
  } catch (_) {}

  // Dispatch custom event for content script to pick up immediately
  try {
    window.dispatchEvent(new CustomEvent('gc_wallet_connected', { detail: { address } }))
  } catch (_) {}

  // Try postMessage to opener as additional fallback
  if (window.opener) {
    try {
      window.opener.postMessage({ type: 'WALLET_CONNECTED', address }, '*')
    } catch (_) {}
  }

  updateStatus('Connected! You can close this tab.', 'success')
  setTimeout(() => window.close(), 1500)
}

function sendError(msg: string) {
  if (addressSent) return

  console.log('Sending error to extension:', msg)
  if (window.opener) {
    window.opener.postMessage({ type: 'CONNECTION_ERROR', error: msg }, '*')
  }
  setTimeout(() => window.close(), 500)
}

// Listen for wallet connection via subscribeProvider
// Gated by userInitiated so cached sessions don't auto-fire on page load
modal.subscribeProvider(async ({ provider, address, isConnected }) => {
  console.log('Provider update:', { address, isConnected })

  // Ignore any cached auto-reconnect that fires before user clicks connect
  if (!userInitiated) {
    console.log('Ignoring cached session on load')
    return
  }

  if (isConnected && address) {
    console.log('Wallet connected! Address:', address)
    updateStatus('Connected! Sending to extension...', 'success')
    sendToExtension(address)
    return
  }

  // Provider exists but address not yet available — fetch it
  if (isConnected && provider && !address) {
    try {
      const ethersProvider = new BrowserProvider(provider)
      const accounts = await ethersProvider.send('eth_requestAccounts', [])
      const fetchedAddress = accounts[0]
      if (fetchedAddress) {
        console.log('Fetched address:', fetchedAddress)
        updateStatus('Connected! Sending to extension...', 'success')
        sendToExtension(fetchedAddress)
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    }
  }
})

async function connectWallet() {
  // Reset flags for fresh connection
  addressSent = false
  userInitiated = true

  // Disconnect any cached session so Web3Modal shows the wallet picker
  try {
    await modal.disconnect()
  } catch (_) {
    // nothing to disconnect
  }

  try {
    connectButton.disabled = true
    updateStatus('Opening wallet selection...', 'connecting')
    console.log('Opening Web3Modal...')
    await modal.open()
  } catch (error) {
    console.error('Failed to open Web3Modal:', error)
    updateStatus('Failed to open wallet selection', 'error')
    sendError('Failed to open wallet selection')
    connectButton.disabled = false
  }
}

window.addEventListener('load', () => {
  console.log('Hosted page loaded')
  connectButton.addEventListener('click', connectWallet)
  statusDiv.classList.add('hidden')
  
  // Load and apply saved theme
  loadTheme()
})

// Theme support
async function loadTheme() {
  try {
    const result = await chrome.storage.local.get('selectedTheme')
    const theme = result.selectedTheme || 'dark'
    applyTheme(theme)
  } catch (err) {
    console.log('Could not load theme (not in extension context)')
  }
}

function applyTheme(theme: string) {
  document.body.classList.remove('theme-dark', 'theme-midnight', 'theme-ocean', 'theme-light', 'theme-pastel')
  document.body.classList.add(`theme-${theme}`)
}

// Listen for theme changes from extension
chrome.runtime?.onMessage.addListener((message) => {
  if (message.type === 'THEME_CHANGED') {
    applyTheme(message.theme)
  }
})

export {}
