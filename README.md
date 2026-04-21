# Snapshot Governance Voting Extension

A Chrome Extension (Manifest V3) that enables wallet connection for Snapshot governance voting using a hosted Web3Modal page.

## Architecture

- **Chrome Extension**: Provides UI and manages wallet address storage
- **Hosted Web3Modal Page**: Handles wallet connection and sends address back to extension
- **Cross-Origin Messaging**: Secure communication between extension and hosted page

## Setup Instructions

### 1. Build the Extension

```bash
npm install
npm run build
```

### 2. Set up the Hosted Page

```bash
cd hosted-page
npm install
npm run build
npm run serve
```

The hosted page will be available at `http://localhost:3000`

### 3. Configure WalletConnect Project ID

1. Go to [WalletConnect Cloud](https://cloud.walletconnect.com/)
2. Create a new project
3. Copy your Project ID
4. Replace `YOUR_WALLETCONNECT_PROJECT_ID` in `hosted-page/src/main.ts`
5. Rebuild the hosted page: `npm run build && npm run serve`

### 4. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `dist` folder from this project
5. The extension should now appear in your extensions list

### 5. Test the Connection

1. Click the extension icon in Chrome toolbar
2. Click "Connect Wallet"
3. A popup window will open with Web3Modal
4. Select your wallet (MetaMask, Coinbase, WalletConnect)
5. Approve the connection in your wallet
6. The extension should show your connected wallet address

## Project Structure

```
├── manifest.json              # Extension manifest
├── popup/                     # Extension popup UI
│   ├── popup.html
│   └── popup.css
├── src/                       # Extension TypeScript source
│   ├── popup.ts              # Main popup logic
│   ├── storage.ts            # Chrome storage interface
│   └── messageHandler.ts     # Cross-origin messaging
├── hosted-page/              # Web3Modal hosted page
│   ├── index.html
│   ├── src/main.ts          # Web3Modal integration
│   └── package.json
└── dist/                     # Built extension files
```

## Security Features

- Origin validation for cross-origin messages
- Ethereum address format validation
- Secure chrome.storage.local for persistence
- Trusted domain restrictions

## Supported Wallets

- MetaMask
- Coinbase Wallet
- WalletConnect (any compatible wallet)

## Development

### Extension Development

```bash
npm run watch  # Watch for TypeScript changes
```

### Hosted Page Development

```bash
cd hosted-page
npm run dev    # Development server with hot reload
```

## Production Deployment

1. **Extension**: Package the `dist` folder for Chrome Web Store submission
2. **Hosted Page**: Deploy the `hosted-page/dist` folder to your domain
3. **Update URLs**: Change localhost URLs to your production domain in:
   - `src/popup.ts` (popupUrl)
   - `src/messageHandler.ts` (TRUSTED_DOMAINS)

## Troubleshooting

### Popup Blocked
- Ensure popups are allowed for the extension
- The connect button must be clicked by user (not programmatically)

### Connection Timeout
- Check that the hosted page is running and accessible
- Verify CORS settings if using a different domain

### Invalid Address Error
- Ensure wallet is properly connected
- Check browser console for detailed error messages

## Next Steps

This MVP provides basic wallet connection. Future enhancements could include:

- Snapshot proposal listing
- Vote signing and submission
- Multiple network support
- Background sync
- Governance notifications