/**
 * Storage interface for managing wallet connection data
 * Uses chrome.storage.local for persistence across extension sessions
 */
/**
 * Validates Ethereum address format
 * @param address - The address to validate
 * @returns true if valid Ethereum address format
 */
export function isValidEthereumAddress(address) {
    // Check if address starts with 0x and has 40 hexadecimal characters
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
}
/**
 * Truncates Ethereum address for display
 * @param address - Full Ethereum address
 * @returns Truncated address in format 0x1234...5678
 */
export function truncateAddress(address) {
    if (!isValidEthereumAddress(address)) {
        return address;
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
/**
 * Chrome storage implementation for wallet data
 */
export class WalletStorage {
    /**
     * Store wallet address with validation
     */
    async setWalletAddress(address) {
        try {
            if (!isValidEthereumAddress(address)) {
                throw new Error(`Invalid Ethereum address format: ${address}`);
            }
            const data = {
                walletAddress: address,
                connectionTimestamp: Date.now()
            };
            await chrome.storage.local.set({
                [WalletStorage.WALLET_ADDRESS_KEY]: address,
                [WalletStorage.CONNECTION_TIMESTAMP_KEY]: data.connectionTimestamp
            });
            console.log('Wallet address stored successfully:', truncateAddress(address));
        }
        catch (error) {
            console.error('Failed to store wallet address:', error);
            throw error;
        }
    }
    /**
     * Retrieve stored wallet address
     */
    async getWalletAddress() {
        try {
            const result = await chrome.storage.local.get([WalletStorage.WALLET_ADDRESS_KEY]);
            const address = result[WalletStorage.WALLET_ADDRESS_KEY];
            if (!address) {
                return null;
            }
            // Validate stored address
            if (!isValidEthereumAddress(address)) {
                console.warn('Invalid stored address found, clearing storage');
                await this.clearWalletData();
                return null;
            }
            return address;
        }
        catch (error) {
            console.error('Failed to retrieve wallet address:', error);
            return null;
        }
    }
    /**
     * Clear all wallet-related data
     */
    async clearWalletData() {
        try {
            await chrome.storage.local.remove([
                WalletStorage.WALLET_ADDRESS_KEY,
                WalletStorage.CONNECTION_TIMESTAMP_KEY
            ]);
            console.log('Wallet data cleared successfully');
        }
        catch (error) {
            console.error('Failed to clear wallet data:', error);
            throw error;
        }
    }
    /**
     * Get connection timestamp
     */
    async getConnectionTimestamp() {
        try {
            const result = await chrome.storage.local.get([WalletStorage.CONNECTION_TIMESTAMP_KEY]);
            return result[WalletStorage.CONNECTION_TIMESTAMP_KEY] || null;
        }
        catch (error) {
            console.error('Failed to retrieve connection timestamp:', error);
            return null;
        }
    }
}
WalletStorage.WALLET_ADDRESS_KEY = 'walletAddress';
WalletStorage.CONNECTION_TIMESTAMP_KEY = 'connectionTimestamp';
