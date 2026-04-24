/**
 * Message handler for secure cross-origin communication
 * Handles wallet connection messages from hosted Web3Modal page
 */

import { isValidEthereumAddress } from './storage.js';

export interface WalletMessage {
  type: 'WALLET_CONNECTED' | 'CONNECTION_ERROR';
  address?: string;
  timestamp: number;
  source: string;
}

export interface MessageHandler {
  validateOrigin(origin: string): boolean;
  validateAddress(address: string): boolean;
  processWalletMessage(event: MessageEvent): Promise<void>;
  handleConnectionError(): void;
}

/**
 * Configuration for trusted domains
 * In production, this should be your actual hosted domain
 */
const TRUSTED_DOMAINS = [
  'https://codevesh090.github.io',  // Production GitHub Pages
];
];

/**
 * Message handler implementation with security validation
 */
export class WalletMessageHandler implements MessageHandler {
  private onWalletConnected?: (address: string) => void;
  private onConnectionError?: (error?: string) => void;

  constructor(
    onWalletConnected?: (address: string) => void,
    onConnectionError?: (error?: string) => void
  ) {
    this.onWalletConnected = onWalletConnected;
    this.onConnectionError = onConnectionError;
  }

  /**
   * Validate message origin against trusted domains
   */
  validateOrigin(origin: string): boolean {
    const isValid = TRUSTED_DOMAINS.includes(origin);
    
    if (!isValid) {
      // console.warn('Message from untrusted origin blocked:', origin);
    }
    
    return isValid;
  }

  /**
   * Validate Ethereum address format
   */
  validateAddress(address: string): boolean {
    return isValidEthereumAddress(address);
  }

  /**
   * Process incoming wallet messages with security validation
   */
  async processWalletMessage(event: MessageEvent): Promise<void> {
    try {
      // console.log('Received message:', event.data, 'from origin:', event.origin);
      
      // Validate origin first
      if (!this.validateOrigin(event.origin)) {
        // console.error('Security violation: Message from untrusted origin:', event.origin);
        return;
      }

      // Validate message structure
      const message = event.data;
      if (!message || typeof message !== 'object') {
        // console.error('Invalid message format received');
        return;
      }

      // console.log('Processing wallet message:', message.type);

      switch (message.type) {
        case 'WALLET_CONNECTED':
          await this.handleWalletConnected(message);
          break;
          
        case 'CONNECTION_ERROR':
          this.handleConnectionError(message.error || 'Connection failed');
          break;
          
        default:
          // console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      // console.error('Error processing wallet message:', error);
      this.handleConnectionError('Message processing failed');
    }
  }

  /**
   * Handle successful wallet connection
   */
  private async handleWalletConnected(message: WalletMessage): Promise<void> {
    if (!message.address) {
      // console.error('Wallet connected message missing address');
      this.handleConnectionError('No wallet address received');
      return;
    }

    // Validate address format
    if (!this.validateAddress(message.address)) {
      // console.error('Invalid Ethereum address format:', message.address);
      this.handleConnectionError('Invalid wallet address format');
      return;
    }

    // console.log('Wallet connected successfully:', message.address.slice(0, 6) + '...' + message.address.slice(-4));
    
    // Call success callback
    if (this.onWalletConnected) {
      this.onWalletConnected(message.address);
    }
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(error?: string): void {
    const errorMessage = error || 'Wallet connection failed';
    // console.error('Wallet connection error:', errorMessage);
    
    // Call error callback
    if (this.onConnectionError) {
      this.onConnectionError(errorMessage);
    }
  }

  /**
   * Set up message listener
   */
  startListening(): void {
    window.addEventListener('message', (event) => {
      this.processWalletMessage(event);
    });
    // console.log('Message handler started listening for wallet messages');
  }

  /**
   * Remove message listener
   */
  stopListening(): void {
    window.removeEventListener('message', (event) => {
      this.processWalletMessage(event);
    });
    // console.log('Message handler stopped listening');
  }
}

/**
 * Utility function to create and configure message handler
 */
export function createMessageHandler(
  onWalletConnected: (address: string) => void,
  onConnectionError: (error?: string) => void
): WalletMessageHandler {
  return new WalletMessageHandler(onWalletConnected, onConnectionError);
}