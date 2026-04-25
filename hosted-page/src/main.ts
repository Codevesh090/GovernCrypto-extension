/**
 * Hosted Web3Modal page for wallet connection
 * 
 * This page is opened by the extension when the user clicks "Connect Wallet".
 * It shows Web3Modal so the user can pick which wallet to use.
 * Once connected, the address is written to localStorage for the
 * content script (walletBridge.ts) to pick up and relay to chrome.storage.
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

// Clear any cached WalletConnect / Web3Modal sessions BEFORE creating the modal
// so it doesn't auto-reconnect to a previous wallet
try {
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && (
      key.startsWith('wc@') ||
      key.startsWith('W3M') ||
      key.startsWith('@w3m') ||
      key.startsWith('wagmi') ||
      key.includes('walletconnect') ||
      key.includes('web3modal')
    )) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k))
  if (keysToRemove.length > 0) {
    console.log('[GC] Cleared', keysToRemove.length, 'cached wallet session keys')
  }
} catch (e) {
  console.log('[GC] Could not clear cached sessions:', e)
}

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

  // Only process if user clicked the connect button
  if (!userInitiated) {
    console.log('[GC] Ignoring provider update (not user-initiated)')
    return
  }

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

// Button click — disconnect any existing session, then open the modal to the Connect view
async function connectWallet() {
  console.log('[GC] Connect clicked')
  addressSent = false
  userInitiated = true
  updateStatus('Opening wallet selector...', 'connecting')

  // Disconnect any stale session first so the modal always shows the wallet picker
  try {
    await modal.disconnect()
    console.log('[GC] Disconnected existing session')
  } catch (_) {
    // No session to disconnect — that's fine
  }

  // Open the modal to the Connect view (wallet selection UI)
  modal.open({ view: 'Connect' })
}

// ---- Initialization ----

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

  // 3. Disconnect any auto-connected session from a previous visit
  try {
    modal.disconnect().catch(() => {})
    console.log('[GC] Cleared any auto-reconnected session')
  } catch (_) {}

  // 4. Load theme (non-blocking, errors silenced)
  loadTheme()
}

async function loadTheme() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get('selectedTheme')
      applyTheme(result.selectedTheme || 'dark')
    } else {
      console.log('[GC] Could not load theme (not in extension context)')
      applyTheme('dark')
    }
  } catch (_) {
    applyTheme('dark')
  }
}

function applyTheme(theme: string) {
  document.body.className = `theme-${theme}`
}

// Listen for theme changes — only in extension context
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
} catch (_) {}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

export {}
