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

  console.log('[GC] Sending address to extension:', address)

  // Write to localStorage — the content script (walletBridge.ts) polls this
  try {
    localStorage.setItem('gc_wallet_address', address)
    localStorage.setItem('gc_wallet_ts', Date.now().toString())
    console.log('[GC] Wrote address to localStorage')
  } catch (e) {
    console.error('[GC] Failed to write localStorage:', e)
  }

  // Also dispatch a custom event for the content script to catch
  try {
    window.dispatchEvent(new CustomEvent('gc_wallet_connected', { detail: { address } }))
    console.log('[GC] Dispatched gc_wallet_connected event')
  } catch (e) {
    console.error('[GC] Failed to dispatch event:', e)
  }

  // If opened via window.open(), also postMessage to the opener
  if (window.opener) {
    try {
      window.opener.postMessage({ type: 'WALLET_CONNECTED', address }, '*')
      console.log('[GC] Sent postMessage to opener')
    } catch (e) {
      console.error('[GC] Failed to postMessage:', e)
    }
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

// ---- Initialization ----
// Use DOMContentLoaded for faster, more reliable setup.
// Each step is isolated so one failure doesn't prevent others.

function init() {
  console.log('[GC] Hosted page loaded')

  // 1. Attach the connect button handler (MOST IMPORTANT)
  try {
    connectButton.addEventListener('click', connectWallet)
    console.log('[GC] Connect button handler attached')
  } catch (e) {
    console.error('[GC] Failed to attach connect handler:', e)
  }

  // 2. Hide status initially
  try {
    statusDiv.classList.add('hidden')
  } catch (_) {}

  // 3. Load theme (non-blocking, errors silenced)
  loadTheme()
}

async function loadTheme() {
  try {
    // chrome.storage is ONLY available in extension contexts (popup, background, content scripts)
    // On the hosted page (regular web page), it does NOT exist — guard carefully
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get('selectedTheme')
      applyTheme(result.selectedTheme || 'dark')
    } else {
      console.log('[GC] Could not load theme (not in extension context)')
      applyTheme('dark')
    }
  } catch (_) {
    console.log('[GC] Could not load theme (not in extension context)')
    applyTheme('dark')
  }
}

function applyTheme(theme: string) {
  document.body.className = `theme-${theme}`
}

// Listen for theme changes from the extension — only if running inside extension context
try {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.onMessage &&
    typeof chrome.runtime.onMessage.addListener === 'function'
  ) {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message.type === 'THEME_CHANGED') applyTheme(message.theme)
    })
  }
} catch (e) {
  // Not in extension context — this is expected on the hosted page
  console.log('[GC] chrome.runtime not available (expected on hosted page)')
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  // DOM already loaded
  init()
}

export {}
