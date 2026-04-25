/**
 * Hosted Web3Modal page for wallet connection
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

  console.log('[GC] Address:', address)

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

  updateStatus('Connected! You can close this tab.', 'success')
  setTimeout(() => window.close(), 1500)
}

// Listen for wallet connection
modal.subscribeProvider(async ({ provider, address, isConnected }) => {
  console.log('[GC] Provider update:', { address, isConnected, userInitiated })

  if (!userInitiated) return

  if (isConnected && address) {
    updateStatus('Connected!', 'success')
    sendToExtension(address)
    return
  }

  if (isConnected && provider && !address) {
    try {
      const ethersProvider = new BrowserProvider(provider)
      const accounts = await ethersProvider.send('eth_requestAccounts', [])
      if (accounts[0]) {
        updateStatus('Connected!', 'success')
        sendToExtension(accounts[0])
      }
    } catch (err) {
      console.error('[GC] Failed to get accounts:', err)
    }
  }
})

// Button click — just open the modal, no await
function connectWallet() {
  console.log('[GC] Connect clicked')
  addressSent = false
  userInitiated = true
  updateStatus('Opening wallet selector...', 'connecting')
  modal.open()
}

window.addEventListener('load', () => {
  console.log('[GC] Page loaded, project:', PROJECT_ID)
  connectButton.addEventListener('click', connectWallet)
  statusDiv.classList.add('hidden')
  loadTheme()
})

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get('selectedTheme')
    applyTheme(result.selectedTheme || 'dark')
  } catch (_) {}
}

function applyTheme(theme: string) {
  document.body.className = `theme-${theme}`
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'THEME_CHANGED') applyTheme(message.theme)
  })
}

export {}
