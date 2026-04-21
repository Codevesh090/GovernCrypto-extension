"use strict";
(() => {
  // src/storage.ts
  function isValidEthereumAddress(address) {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }
  function truncateAddress(address) {
    if (!isValidEthereumAddress(address)) {
      return address;
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
  var WalletStorage = class _WalletStorage {
    static {
      this.WALLET_ADDRESS_KEY = "walletAddress";
    }
    static {
      this.CONNECTION_TIMESTAMP_KEY = "connectionTimestamp";
    }
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
          [_WalletStorage.WALLET_ADDRESS_KEY]: address,
          [_WalletStorage.CONNECTION_TIMESTAMP_KEY]: data.connectionTimestamp
        });
        console.log("Wallet address stored successfully:", truncateAddress(address));
      } catch (error) {
        console.error("Failed to store wallet address:", error);
        throw error;
      }
    }
    /**
     * Retrieve stored wallet address
     */
    async getWalletAddress() {
      try {
        const result = await chrome.storage.local.get([_WalletStorage.WALLET_ADDRESS_KEY]);
        const address = result[_WalletStorage.WALLET_ADDRESS_KEY];
        if (!address) {
          return null;
        }
        if (!isValidEthereumAddress(address)) {
          console.warn("Invalid stored address found, clearing storage");
          await this.clearWalletData();
          return null;
        }
        return address;
      } catch (error) {
        console.error("Failed to retrieve wallet address:", error);
        return null;
      }
    }
    /**
     * Clear all wallet-related data
     */
    async clearWalletData() {
      try {
        await chrome.storage.local.remove([
          _WalletStorage.WALLET_ADDRESS_KEY,
          _WalletStorage.CONNECTION_TIMESTAMP_KEY
        ]);
        console.log("Wallet data cleared successfully");
      } catch (error) {
        console.error("Failed to clear wallet data:", error);
        throw error;
      }
    }
    /**
     * Get connection timestamp
     */
    async getConnectionTimestamp() {
      try {
        const result = await chrome.storage.local.get([_WalletStorage.CONNECTION_TIMESTAMP_KEY]);
        return result[_WalletStorage.CONNECTION_TIMESTAMP_KEY] || null;
      } catch (error) {
        console.error("Failed to retrieve connection timestamp:", error);
        return null;
      }
    }
  };

  // src/popup.ts
  console.log("Snapshot Governance Extension - Popup loaded");
  var HOSTED_PAGE_URL = "http://localhost:3000";
  var TRUSTED_ORIGIN = "http://localhost:3000";
  var storage = new WalletStorage();
  var isConnecting = false;
  var disconnectedState;
  var connectingState;
  var connectedState;
  var errorState;
  var connectBtn;
  var cancelBtn;
  var disconnectBtn;
  var changeWalletBtn;
  var retryBtn;
  var walletAddressEl;
  var errorTextEl;
  function showState(state) {
    disconnectedState.classList.add("hidden");
    connectingState.classList.add("hidden");
    connectedState.classList.add("hidden");
    errorState.classList.add("hidden");
    if (state === "disconnected") disconnectedState.classList.remove("hidden");
    if (state === "connecting") connectingState.classList.remove("hidden");
    if (state === "connected") connectedState.classList.remove("hidden");
    if (state === "error") errorState.classList.remove("hidden");
  }
  function showConnected(address) {
    walletAddressEl.textContent = truncateAddress(address);
    showState("connected");
  }
  function showError(msg) {
    errorTextEl.textContent = msg;
    showState("error");
    isConnecting = false;
  }
  function connectWallet() {
    isConnecting = true;
    showState("connecting");
    const features = "width=420,height=640,left=200,top=100";
    const popup = window.open(HOSTED_PAGE_URL, "walletConnect", features);
    if (!popup) {
      showError("Popup was blocked. Please allow popups for this extension.");
      return;
    }
  }
  window.addEventListener("message", async (event) => {
    console.log("Received message:", event.data, "from:", event.origin);
    if (event.origin !== TRUSTED_ORIGIN) {
      console.warn("Ignored message from untrusted origin:", event.origin);
      return;
    }
    if (!isConnecting) return;
    if (event.data?.type === "WALLET_CONNECTED") {
      const address = event.data.address;
      console.log("Wallet connected! Address:", address);
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        showError("Invalid wallet address received.");
        return;
      }
      try {
        await chrome.storage.local.set({ connectedAddress: address });
        isConnecting = false;
        showConnected(address);
      } catch (err) {
        showError("Failed to save wallet address.");
      }
    }
    if (event.data?.type === "CONNECTION_ERROR") {
      console.log("Connection error received");
      showError(event.data.error || "Connection failed. Please try again.");
    }
  });
  async function changeWallet() {
    await chrome.storage.local.remove("connectedAddress");
    isConnecting = true;
    showState("connecting");
    const features = "width=420,height=640,left=200,top=100";
    const popup = window.open(HOSTED_PAGE_URL, "walletConnect", features);
    if (!popup) {
      showError("Popup was blocked. Please allow popups for this extension.");
    }
  }
  async function disconnectWallet() {
    await chrome.storage.local.remove("connectedAddress");
    showState("disconnected");
  }
  async function initialize() {
    disconnectedState = document.getElementById("disconnected-state");
    connectingState = document.getElementById("connecting-state");
    connectedState = document.getElementById("connected-state");
    errorState = document.getElementById("error-state");
    connectBtn = document.getElementById("connect-btn");
    cancelBtn = document.getElementById("cancel-btn");
    disconnectBtn = document.getElementById("disconnect-btn");
    changeWalletBtn = document.getElementById("change-wallet-btn");
    retryBtn = document.getElementById("retry-btn");
    walletAddressEl = document.getElementById("wallet-address");
    errorTextEl = document.getElementById("error-text");
    connectBtn.addEventListener("click", connectWallet);
    retryBtn.addEventListener("click", connectWallet);
    changeWalletBtn.addEventListener("click", changeWallet);
    cancelBtn.addEventListener("click", () => {
      isConnecting = false;
      showState("disconnected");
    });
    disconnectBtn.addEventListener("click", disconnectWallet);
    const result = await chrome.storage.local.get("connectedAddress");
    if (result.connectedAddress) {
      showConnected(result.connectedAddress);
    } else {
      showState("disconnected");
    }
  }
  document.addEventListener("DOMContentLoaded", initialize);
})();
