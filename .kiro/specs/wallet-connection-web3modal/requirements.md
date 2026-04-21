# Requirements Document

## Introduction

The Snapshot Governance Voting Extension - Feature 1: Wallet Connection via Hosted Web3Modal implements wallet connection functionality using a hosted dApp page architecture. This feature enables users to connect their Web3 wallets (MetaMask, Coinbase, WalletConnect) through a Chrome extension that opens a hosted webpage for wallet interaction, then receives and persists the wallet address locally.

## Glossary

- **Extension**: The Chrome Extension (Manifest V3) component that provides the user interface and manages local storage
- **Hosted_Page**: The web application hosted on a trusted domain that handles Web3Modal wallet connection
- **Web3Modal**: The wallet connection library that provides a unified interface for multiple wallet providers
- **Wallet_Address**: The Ethereum address returned from the connected wallet
- **Chrome_Storage**: The chrome.storage.local API used for persisting wallet addresses
- **PostMessage_API**: The browser API used for cross-origin communication between extension and hosted page
- **Trusted_Domain**: The specific domain origin that is authorized to send wallet addresses to the extension

## Requirements

### Requirement 1: Wallet Connection Initiation

**User Story:** As a user, I want to click a connect button in the extension, so that I can initiate the wallet connection process.

#### Acceptance Criteria

1. WHEN the user clicks the connect wallet button, THE Extension SHALL open the Hosted_Page in a centered popup window using window.open with controlled width and height
2. THE popup window SHALL have dimensions approximately 400x600 pixels to provide a focused wallet connection experience
3. THE Extension SHALL use window.open to prevent popup blocking issues
4. THE Extension SHALL open the Hosted_Page at the predefined trusted URL
5. WHILE the connection process is active, THE Extension SHALL disable the connect button and display a loading indicator to prevent multiple connection attempts

### Requirement 2: Web3Modal Wallet Selection

**User Story:** As a user, I want to see wallet options on the hosted page, so that I can choose my preferred wallet provider.

#### Acceptance Criteria

1. WHEN the Hosted_Page loads, THE Web3Modal SHALL display available wallet options
2. THE Web3Modal SHALL support MetaMask wallet connections
3. THE Web3Modal SHALL support Coinbase wallet connections  
4. THE Web3Modal SHALL support WalletConnect protocol connections
5. THE Hosted_Page SHALL use the ethers version of Web3Modal

### Requirement 3: Wallet Connection Process

**User Story:** As a user, I want to connect my wallet through the hosted page, so that my wallet address can be used by the extension.

#### Acceptance Criteria

1. WHEN the user selects a wallet option, THE Web3Modal SHALL initiate the connection process
2. WHEN the wallet connection is successful, THE Hosted_Page SHALL retrieve the Wallet_Address
3. WHEN the Wallet_Address is obtained, THE Hosted_Page SHALL send the wallet address using window.opener.postMessage with a wildcard (*) target origin
4. THE Hosted_Page SHALL include the wallet address in the message payload
5. THE Extension SHALL validate the event.origin against the predefined Trusted_Domain before processing the message
6. AFTER successfully sending the Wallet_Address to the Extension, THE Hosted_Page SHALL automatically close the popup window

### Requirement 4: Cross-Origin Message Handling

**User Story:** As a user, I want the extension to securely receive my wallet address, so that only trusted sources can provide wallet information.

#### Acceptance Criteria

1. WHEN the Extension receives a postMessage event, THE Extension SHALL validate the event.origin against the Trusted_Domain
2. IF the event.origin does not match the Trusted_Domain, THEN THE Extension SHALL ignore the message
3. WHEN a valid message is received, THE Extension SHALL extract the Wallet_Address from the message data
4. THE Extension SHALL only process messages that contain a valid Ethereum address format

### Requirement 5: Address Persistence

**User Story:** As a user, I want my wallet address to be remembered, so that I don't need to reconnect every time I use the extension.

#### Acceptance Criteria

1. WHEN a valid Wallet_Address is received, THE Extension SHALL store it in Chrome_Storage
2. THE Extension SHALL use chrome.storage.local for address persistence
3. WHEN the Extension starts, THE Extension SHALL check Chrome_Storage for an existing Wallet_Address
4. IF a stored Wallet_Address exists, THEN THE Extension SHALL display the connected state

### Requirement 6: UI State Management

**User Story:** As a user, I want to see the current connection status, so that I know whether my wallet is connected.

#### Acceptance Criteria

1. WHEN no Wallet_Address is stored, THE Extension SHALL display a "Connect Wallet" button
2. WHEN a Wallet_Address is stored, THE Extension SHALL display the connected wallet address
3. WHEN a Wallet_Address is stored, THE Extension SHALL display a "Disconnect" button
4. THE Extension SHALL update the UI immediately after receiving a new Wallet_Address
5. THE Extension SHALL show a truncated version of the Wallet_Address for display purposes

### Requirement 7: Wallet Disconnection

**User Story:** As a user, I want to disconnect my wallet, so that I can clear my connection and connect a different wallet.

#### Acceptance Criteria

1. WHEN the user clicks the disconnect button, THE Extension SHALL remove the Wallet_Address from Chrome_Storage
2. WHEN the Wallet_Address is removed, THE Extension SHALL update the UI to show the disconnected state
3. THE Extension SHALL clear all stored wallet-related data during disconnection
4. AFTER disconnection, THE Extension SHALL display the "Connect Wallet" button again

### Requirement 8: Security Validation

**User Story:** As a user, I want my wallet connection to be secure, so that malicious websites cannot inject fake wallet addresses.

#### Acceptance Criteria

1. THE Extension SHALL only accept postMessage events from the predefined Trusted_Domain
2. THE Extension SHALL validate that received addresses match Ethereum address format (0x followed by 40 hexadecimal characters)
3. IF an invalid address format is received, THEN THE Extension SHALL reject the message and log an error
4. THE Extension SHALL not store or display invalid wallet addresses
5. THE Extension SHALL implement origin validation before processing any cross-origin messages