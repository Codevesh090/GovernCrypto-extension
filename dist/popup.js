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

  // src/snapshot.ts
  var SNAPSHOT_API = "https://hub.snapshot.org/graphql";
  var DAO_FALLBACKS = {
    "ens.eth": ["ens.eth"],
    "uniswapgovernance.eth": ["uniswapgovernance.eth"],
    "aave.eth": ["aave.eth", "aavegotchi.eth"],
    "makerdao.eth": ["makerdao.eth", "makergov.eth"],
    "compound-governance.eth": ["compound-governance.eth", "comp-vote.eth"],
    "curve.eth": ["curve.eth", "cvx.eth"],
    "balancer.eth": ["balancer.eth"],
    "sushigov.eth": ["sushigov.eth", "sushi.eth"],
    "gitcoindao.eth": ["gitcoindao.eth", "gitcoin.eth"],
    "arbitrumfoundation.eth": ["arbitrumfoundation.eth"]
  };
  async function fetchGraphQL(body) {
    const res = await fetch(SNAPSHOT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data.proposals;
  }
  async function fetchAllActiveProposals() {
    const query = `{
    proposals(
      first: 40,
      skip: 0,
      where: { state: "active" },
      orderBy: "end",
      orderDirection: asc
    ) {
      id title body choices start end state
      scores scores_total
      space { id name }
    }
  }`;
    return fetchGraphQL({ query });
  }
  async function fetchProposalsBySpace(spaceId) {
    const query = `
    query GetDAOProposals($space: String!) {
      proposals(
        first: 5,
        skip: 0,
        where: { space: $space },
        orderBy: "created",
        orderDirection: desc
      ) {
        id title body choices start end state
        scores scores_total
        space { id name }
      }
    }
  `;
    return fetchGraphQL({ query, variables: { space: spaceId } });
  }
  async function fetchDAOProposals(spaceKey) {
    const spaces = DAO_FALLBACKS[spaceKey] || [spaceKey];
    console.log("DAO:", spaceKey, "\u2192 trying spaces:", spaces);
    for (const space of spaces) {
      try {
        const data = await fetchProposalsBySpace(space);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`Proposals fetched from ${space}:`, data.length);
          return data;
        }
        console.warn(`Empty response from ${space}, trying next...`);
      } catch (err) {
        console.warn(`Failed for ${space}:`, err);
      }
    }
    console.warn(`All fallbacks exhausted for ${spaceKey}`);
    return [];
  }

  // src/proposals.ts
  function stripMarkdown(text) {
    if (!text) return "";
    return text.replace(/#{1,6}\s/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^>\s*/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\n{2,}/g, " ").trim();
  }
  function formatTime(unixTimestamp, state) {
    const now = Math.floor(Date.now() / 1e3);
    const diff = unixTimestamp - now;
    const absDiff = Math.abs(diff);
    const days = Math.floor(absDiff / 86400);
    const hours = Math.floor(absDiff % 86400 / 3600);
    if (state === "active") {
      if (days > 0) return `Ends in ${days}d ${hours}h`;
      if (hours > 0) return `Ends in ${hours}h`;
      return "Ending soon";
    }
    if (state === "pending") {
      if (days > 0) return `Starts in ${days}d ${hours}h`;
      if (hours > 0) return `Starts in ${hours}h`;
      return "Starting soon";
    }
    if (days > 0) return `Ended ${days}d ago`;
    if (hours > 0) return `Ended ${hours}h ago`;
    return "Just ended";
  }
  function calcPercentages(scores, scores_total) {
    if (!scores || scores.length === 0 || !scores_total || scores_total === 0) return [];
    return scores.map((s) => Math.round(s / scores_total * 100));
  }
  function transformProposal(raw) {
    if (!raw) return null;
    const plainBody = stripMarkdown(raw.body || "");
    const percentages = calcPercentages(raw.scores || [], raw.scores_total || 0);
    const title = raw.title || "Untitled";
    return {
      id: raw.id,
      title: title.length > 80 ? title.slice(0, 80) + "..." : title,
      bodyPreview: plainBody.length > 200 ? plainBody.slice(0, 200) + "..." : plainBody,
      bodyDetail: plainBody.length > 1e3 ? plainBody.slice(0, 1e3) + "..." : plainBody,
      choices: Array.isArray(raw.choices) ? raw.choices : [],
      scores: Array.isArray(raw.scores) ? raw.scores : [],
      percentages,
      scores_total: raw.scores_total || 0,
      state: raw.state || "closed",
      timeLabel: formatTime(raw.end, raw.state),
      spaceName: raw.space?.name || raw.space?.id || "Unknown DAO",
      spaceId: raw.space?.id || "",
      start: raw.start || 0,
      end: raw.end || 0
    };
  }

  // src/popup.ts
  console.log("Snapshot Governance Extension - Popup loaded");
  var HOSTED_PAGE_URL = "http://localhost:3000";
  var TRUSTED_ORIGIN = "http://localhost:3000";
  function updateOfflineBanner() {
    const banner = document.getElementById("offline-banner");
    if (!banner) return;
    if (!navigator.onLine) {
      banner.style.display = "block";
      document.body.classList.add("is-offline");
    } else {
      banner.style.display = "none";
      document.body.classList.remove("is-offline");
    }
  }
  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);
  function createDaoLogo(spaceId, label) {
    const img = document.createElement("img");
    img.className = "dao-logo";
    img.alt = label;
    img.src = `https://cdn.stamp.fyi/space/${spaceId}?s=36`;
    img.onerror = () => {
      const fallback = document.createElement("div");
      fallback.className = "dao-logo-fallback";
      fallback.textContent = label.charAt(0).toUpperCase();
      img.replaceWith(fallback);
    };
    return img;
  }
  var storage = new WalletStorage();
  var isConnecting = false;
  var appState = {
    screen: "connect",
    proposals: [],
    selectedProposal: null,
    address: "",
    activeTab: "all"
  };
  var isLoadingProposals = false;
  var lastFetchTime = 0;
  var CACHE_TTL_MS = 60 * 60 * 1e3;
  var autoReloadTimer;
  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((el) => {
      el.style.display = "none";
    });
  }
  function renderCurrentScreen() {
    hideAllScreens();
    switch (appState.screen) {
      case "connect":
        showConnectScreen();
        break;
      case "connected":
        showConnectedScreen(appState.address);
        break;
      case "proposals":
        document.getElementById("screen-proposals").style.display = "flex";
        break;
      case "detail":
        document.getElementById("screen-detail").style.display = "flex";
        if (!appState.selectedProposal) return;
        renderProposalDetail(appState.selectedProposal);
        break;
    }
  }
  function navigate(screen, data) {
    appState.screen = screen;
    if (data?.proposal) appState.selectedProposal = data.proposal;
    renderCurrentScreen();
  }
  var disconnectedState;
  var connectingState;
  var connectedState;
  var errorState;
  var connectBtn;
  var cancelBtn;
  var disconnectBtn;
  var changeWalletBtn;
  var walletAddressEl;
  var errorTextEl;
  function showConnectScreen() {
    disconnectedState.style.display = "block";
    connectingState.style.display = "none";
    connectedState.style.display = "none";
    errorState.style.display = "none";
  }
  function showConnectedScreen(address) {
    walletAddressEl.textContent = truncateAddress(address);
    disconnectedState.style.display = "none";
    connectingState.style.display = "none";
    connectedState.style.display = "block";
    errorState.style.display = "none";
  }
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
    appState.address = address;
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
    appState.address = "";
    appState.proposals = [];
    showState("disconnected");
  }
  function showProposalsLoading() {
    document.getElementById("proposals-loading").style.display = "flex";
    document.getElementById("proposals-list").style.display = "none";
    document.getElementById("proposals-empty").style.display = "none";
    document.getElementById("proposals-error").style.display = "none";
  }
  function showProposalsEmpty() {
    document.getElementById("proposals-loading").style.display = "none";
    document.getElementById("proposals-list").style.display = "none";
    document.getElementById("proposals-empty").style.display = "block";
    document.getElementById("proposals-error").style.display = "none";
  }
  function showProposalsError(msg) {
    document.getElementById("proposals-loading").style.display = "none";
    document.getElementById("proposals-list").style.display = "none";
    document.getElementById("proposals-empty").style.display = "none";
    document.getElementById("proposals-error").style.display = "block";
    document.getElementById("proposals-error-msg").textContent = msg;
  }
  function renderProposalsList(proposals) {
    const list = document.getElementById("proposals-list");
    list.innerHTML = "";
    const safeProposals = proposals.filter(Boolean);
    if (!safeProposals.length) {
      showProposalsEmpty();
      return;
    }
    document.getElementById("proposals-loading").style.display = "none";
    document.getElementById("proposals-empty").style.display = "none";
    document.getElementById("proposals-error").style.display = "none";
    list.style.display = "block";
    const frag = document.createDocumentFragment();
    for (const p of safeProposals) {
      const card = document.createElement("div");
      card.className = "proposal-card";
      card.onclick = () => navigate("detail", { proposal: p });
      const cardHeader = document.createElement("div");
      cardHeader.className = "card-header";
      const spaceRow = document.createElement("div");
      spaceRow.className = "card-space-row";
      const logo = createDaoLogo(p.spaceId, p.spaceName);
      const spaceName = document.createElement("span");
      spaceName.className = "card-space";
      spaceName.textContent = p.spaceName;
      spaceRow.appendChild(logo);
      spaceRow.appendChild(spaceName);
      const badge = document.createElement("span");
      badge.className = `badge badge-${p.state}`;
      badge.textContent = p.state.toUpperCase();
      cardHeader.appendChild(spaceRow);
      cardHeader.appendChild(badge);
      const title = document.createElement("p");
      title.className = "card-title";
      title.textContent = p.title;
      card.appendChild(cardHeader);
      card.appendChild(title);
      if (p.scores_total > 0 && p.percentages.length > 0) {
        const pairs = p.choices.map((c, i) => ({ choice: c, percent: p.percentages[i] || 0, score: p.scores[i] || 0 })).filter((_, i) => p.choices[i] !== void 0 && p.percentages[i] !== void 0);
        pairs.sort((a, b) => b.percent - a.percent);
        const topTwo = pairs.slice(0, 2);
        const colors = ["green", "red"];
        topTwo.forEach(({ choice, percent, score }, idx) => {
          const row = document.createElement("div");
          row.className = "choice-row";
          const label = document.createElement("span");
          label.className = `choice-label color-${colors[idx]}`;
          label.textContent = `${choice} ${percent}%`;
          const vpSpan = document.createElement("span");
          vpSpan.className = "vp-amount";
          vpSpan.textContent = formatVotingPower(score);
          const bar = document.createElement("div");
          bar.className = "progress-bar";
          const fill = document.createElement("div");
          fill.className = `progress-fill fill-${colors[idx]}`;
          fill.style.width = `${percent}%`;
          bar.appendChild(fill);
          row.appendChild(label);
          row.appendChild(bar);
          row.appendChild(vpSpan);
          card.appendChild(row);
        });
      } else {
        const noVotes = document.createElement("p");
        noVotes.className = "card-time";
        noVotes.style.fontStyle = "italic";
        if (p.state === "active") noVotes.textContent = "No votes yet";
        else if (p.state === "pending") noVotes.textContent = "Voting not started";
        else noVotes.textContent = "No votes cast";
        card.appendChild(noVotes);
      }
      const timeLabel = p.timeLabel;
      const isUrgent = p.state === "active" && (timeLabel.includes("Ending soon") || timeLabel.includes("Ends in") && !timeLabel.includes("d "));
      const time = document.createElement("p");
      time.className = isUrgent ? "time-urgent" : "time-normal";
      time.textContent = timeLabel;
      card.appendChild(time);
      if (p.start && p.end) {
        const pct = calcTimelinePercent(p.start, p.end, p.state);
        const isEnded = p.state === "closed";
        const isPending = p.state === "pending";
        const tlSection = document.createElement("div");
        tlSection.className = "timeline-section";
        const tlRow = document.createElement("div");
        tlRow.className = "timeline-horizontal";
        const startNode = document.createElement("div");
        startNode.className = "timeline-node";
        const startDot = document.createElement("div");
        startDot.className = "timeline-dot";
        const startLbl = document.createElement("div");
        startLbl.className = "timeline-node-label";
        startLbl.textContent = "Start";
        const startDate = document.createElement("div");
        startDate.className = "timeline-node-date";
        startDate.textContent = new Date(p.start * 1e3).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        startNode.appendChild(startDot);
        startNode.appendChild(startLbl);
        startNode.appendChild(startDate);
        const line = document.createElement("div");
        line.className = "timeline-line";
        const lineFill = document.createElement("div");
        lineFill.className = `timeline-line-fill${isEnded ? " ended" : isPending ? " pending-line" : ""}`;
        lineFill.style.width = `${pct}%`;
        line.appendChild(lineFill);
        const endNode = document.createElement("div");
        endNode.className = "timeline-node";
        const endDot = document.createElement("div");
        endDot.className = `timeline-dot${isEnded ? "" : " inactive"}`;
        const endLbl = document.createElement("div");
        endLbl.className = "timeline-node-label";
        endLbl.textContent = "End";
        const endDate = document.createElement("div");
        endDate.className = "timeline-node-date";
        endDate.textContent = new Date(p.end * 1e3).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        endNode.appendChild(endDot);
        endNode.appendChild(endLbl);
        endNode.appendChild(endDate);
        tlRow.appendChild(startNode);
        tlRow.appendChild(line);
        tlRow.appendChild(endNode);
        tlSection.appendChild(tlRow);
        if (isEnded) {
          const closedTag = document.createElement("div");
          closedTag.className = "timeline-closed-tag";
          closedTag.textContent = "\u2713 Event Closed";
          tlSection.appendChild(closedTag);
        }
        card.appendChild(tlSection);
      }
      frag.appendChild(card);
    }
    list.appendChild(frag);
  }
  function renderProposalDetail(proposal) {
    const container = document.getElementById("detail-content");
    container.innerHTML = "";
    const header = document.createElement("div");
    header.className = "detail-header";
    const spaceRow = document.createElement("div");
    spaceRow.className = "detail-space-logo-row";
    const detailLogo = createDaoLogo(proposal.spaceId, proposal.spaceName);
    const spaceName = document.createElement("span");
    spaceName.textContent = proposal.spaceName;
    const badge = document.createElement("span");
    badge.className = `badge badge-${proposal.state}`;
    badge.textContent = proposal.state.toUpperCase();
    spaceRow.appendChild(detailLogo);
    spaceRow.appendChild(spaceName);
    spaceRow.appendChild(badge);
    const title = document.createElement("p");
    title.className = "detail-title";
    title.textContent = proposal.title;
    const time = document.createElement("p");
    time.className = "detail-time";
    time.textContent = proposal.timeLabel;
    header.appendChild(spaceRow);
    header.appendChild(title);
    header.appendChild(time);
    container.appendChild(header);
    const descLabel = document.createElement("p");
    descLabel.className = "detail-section-label";
    descLabel.textContent = "Description";
    container.appendChild(descLabel);
    const body = document.createElement("p");
    body.className = "detail-body";
    body.textContent = proposal.bodyDetail || "No description available.";
    container.appendChild(body);
    const div1 = document.createElement("div");
    div1.className = "detail-divider";
    container.appendChild(div1);
    const votesLabel = document.createElement("p");
    votesLabel.className = "detail-section-label";
    votesLabel.textContent = "Current Votes";
    container.appendChild(votesLabel);
    if (proposal.scores_total > 0 && proposal.percentages.length > 0) {
      const pairs = proposal.choices.map((c, i) => ({ choice: c, percent: proposal.percentages[i] || 0, score: proposal.scores[i] || 0, idx: i })).filter((item) => proposal.choices[item.idx] !== void 0 && proposal.percentages[item.idx] !== void 0);
      const sorted = [...pairs].sort((a, b) => b.percent - a.percent);
      const rankColors = ["green", "red"];
      const colorByChoice = /* @__PURE__ */ new Map();
      sorted.forEach((item, rank) => {
        colorByChoice.set(item.choice, rankColors[rank] || "grey");
      });
      pairs.forEach(({ choice, percent, score }) => {
        const color = colorByChoice.get(choice) || "grey";
        const row = document.createElement("div");
        row.className = "detail-choice-row";
        const label = document.createElement("span");
        label.className = `detail-choice-label color-${color}`;
        label.textContent = choice;
        const bar = document.createElement("div");
        bar.className = "progress-bar";
        const fill = document.createElement("div");
        fill.className = `progress-fill fill-${color}`;
        fill.style.width = `${percent}%`;
        bar.appendChild(fill);
        const pct = document.createElement("span");
        pct.className = `detail-choice-pct color-${color}`;
        pct.textContent = `${percent}%`;
        const vp = document.createElement("span");
        vp.className = "vp-amount";
        vp.textContent = formatVotingPower(score);
        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(pct);
        row.appendChild(vp);
        container.appendChild(row);
      });
    } else {
      const noVotes = document.createElement("p");
      noVotes.className = "detail-body";
      noVotes.textContent = "No votes recorded yet.";
      container.appendChild(noVotes);
    }
    const div2 = document.createElement("div");
    div2.className = "detail-divider";
    container.appendChild(div2);
    if (proposal.start && proposal.end) {
      let makeNode2 = function(label, ts, active) {
        const node = document.createElement("div");
        node.className = "detail-timeline-node";
        const dot = document.createElement("div");
        dot.className = `detail-timeline-dot${active ? "" : " inactive"}`;
        const lbl = document.createElement("div");
        lbl.className = "detail-timeline-node-label";
        lbl.textContent = label;
        const date = document.createElement("div");
        date.className = "detail-timeline-node-date";
        const d = new Date(ts * 1e3);
        date.textContent = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " \xB7 " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        node.appendChild(dot);
        node.appendChild(lbl);
        node.appendChild(date);
        return node;
      };
      var makeNode = makeNode2;
      const pct = calcTimelinePercent(proposal.start, proposal.end, proposal.state);
      const isEnded = proposal.state === "closed";
      const isPending = proposal.state === "pending";
      const tlSection = document.createElement("div");
      tlSection.className = "detail-timeline-section";
      const tlLabel = document.createElement("p");
      tlLabel.className = "detail-section-label";
      tlLabel.textContent = "\u23F1 Timeline";
      tlSection.appendChild(tlLabel);
      const tlRow = document.createElement("div");
      tlRow.className = "detail-timeline-horizontal";
      const startNode = makeNode2("Start", proposal.start, true);
      const line = document.createElement("div");
      line.className = "detail-timeline-line";
      const lineFill = document.createElement("div");
      lineFill.className = `detail-timeline-line-fill${isEnded ? " ended" : ""}`;
      lineFill.style.width = isPending ? "0%" : `${pct}%`;
      line.appendChild(lineFill);
      const endNode = makeNode2("End", proposal.end, isEnded);
      tlRow.appendChild(startNode);
      tlRow.appendChild(line);
      tlRow.appendChild(endNode);
      tlSection.appendChild(tlRow);
      if (isEnded) {
        const closedTag = document.createElement("div");
        closedTag.className = "timeline-closed-tag";
        closedTag.textContent = "\u2713 Event Closed";
        tlSection.appendChild(closedTag);
      }
      container.appendChild(tlSection);
    }
    const div3 = document.createElement("div");
    div3.className = "detail-divider";
    container.appendChild(div3);
    const voteLabel = document.createElement("p");
    voteLabel.className = "detail-section-label";
    voteLabel.textContent = "Cast Your Vote";
    container.appendChild(voteLabel);
    const voteButtons = document.createElement("div");
    voteButtons.className = "vote-buttons";
    proposal.choices.forEach((choice) => {
      if (!choice) return;
      const btn = document.createElement("button");
      btn.className = "vote-btn";
      btn.textContent = choice;
      btn.disabled = true;
      voteButtons.appendChild(btn);
    });
    container.appendChild(voteButtons);
    const note = document.createElement("p");
    note.className = "vote-note";
    note.textContent = "Voting coming in next update";
    container.appendChild(note);
    const readBtn = document.createElement("a");
    readBtn.className = "read-full-btn";
    readBtn.textContent = "\u2197 Read Full Proposal";
    readBtn.href = `https://snapshot.org/#/${proposal.spaceId}/proposal/${proposal.id}`;
    readBtn.target = "_blank";
    readBtn.rel = "noopener noreferrer";
    container.appendChild(readBtn);
  }
  function updateActiveTabUI() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.classList.remove("active");
    });
    document.querySelector(`.tab[data-tab="${appState.activeTab}"]`)?.classList.add("active");
  }
  function bindTabEvents() {
    document.querySelectorAll(".tab").forEach((btn) => {
      const tabEl = btn;
      const tabId = tabEl.dataset.tab;
      const label = tabEl.textContent?.trim() || tabId;
      if (tabId !== "all") {
        tabEl.innerHTML = "";
        const inner = document.createElement("span");
        inner.className = "tab-inner";
        const logo = createDaoLogo(tabId, label);
        const text = document.createElement("span");
        text.textContent = label;
        inner.appendChild(logo);
        inner.appendChild(text);
        tabEl.appendChild(inner);
      }
      tabEl.addEventListener("click", async (e) => {
        const tab = e.currentTarget.dataset.tab;
        if (appState.activeTab === tab) return;
        appState.activeTab = tab;
        appState.proposals = [];
        lastFetchTime = 0;
        updateActiveTabUI();
        await loadProposalsByTab();
      });
    });
  }
  function formatVotingPower(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(0);
  }
  function calcTimelinePercent(start, end, state) {
    if (state === "pending") return 0;
    if (state === "closed") return 100;
    const now = Math.floor(Date.now() / 1e3);
    const total = end - start;
    if (total <= 0) return 100;
    const elapsed = now - start;
    return Math.min(100, Math.max(0, Math.round(elapsed / total * 100)));
  }
  function updateLastUpdatedLabel() {
    const el = document.getElementById("last-updated-label");
    if (!el) return;
    if (!lastFetchTime) {
      el.textContent = "";
      return;
    }
    const mins = Math.floor((Date.now() - lastFetchTime) / 6e4);
    el.textContent = mins < 1 ? "Updated just now" : `Updated ${mins}m ago`;
  }
  async function loadProposalsByTab(forceReload = false) {
    if (isLoadingProposals) return;
    if (!navigator.onLine) {
      showProposalsError("You are offline. Please check your connection and try again.");
      return;
    }
    if (!forceReload && lastFetchTime && Date.now() - lastFetchTime < CACHE_TTL_MS) {
      if (appState.proposals.length > 0) {
        renderProposalsList(appState.proposals);
        return;
      }
    }
    isLoadingProposals = true;
    showProposalsLoading();
    const reloadBtn = document.getElementById("btn-reload-proposals");
    reloadBtn?.classList.add("loading");
    try {
      let raw;
      if (appState.activeTab === "all") {
        raw = await fetchAllActiveProposals();
      } else {
        raw = await fetchDAOProposals(appState.activeTab);
      }
      console.log("DAO:", appState.activeTab, "| Proposals fetched:", raw.length);
      const proposals = raw.map(transformProposal).filter(Boolean);
      appState.proposals = proposals;
      lastFetchTime = Date.now();
      updateLastUpdatedLabel();
      if (proposals.length === 0) {
        showProposalsEmpty();
      } else {
        renderProposalsList(proposals);
      }
      if (autoReloadTimer) clearTimeout(autoReloadTimer);
      autoReloadTimer = window.setTimeout(() => {
        if (appState.screen === "proposals") {
          loadProposalsByTab(true);
        }
      }, CACHE_TTL_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load proposals";
      showProposalsError(msg);
    } finally {
      isLoadingProposals = false;
      reloadBtn?.classList.remove("loading");
    }
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
    walletAddressEl = document.getElementById("wallet-address");
    errorTextEl = document.getElementById("error-text");
    connectBtn.addEventListener("click", connectWallet);
    document.getElementById("retry-btn").addEventListener("click", connectWallet);
    changeWalletBtn.addEventListener("click", changeWallet);
    cancelBtn.addEventListener("click", () => {
      isConnecting = false;
      showState("disconnected");
    });
    disconnectBtn.addEventListener("click", disconnectWallet);
    document.getElementById("btn-proposals").addEventListener("click", async () => {
      appState.activeTab = "all";
      navigate("proposals");
      updateActiveTabUI();
      await loadProposalsByTab();
    });
    document.getElementById("btn-back-proposals").addEventListener("click", () => {
      navigate("connected");
    });
    document.getElementById("btn-back-detail").addEventListener("click", () => {
      navigate("proposals");
      if (appState.proposals.length > 0) {
        renderProposalsList(appState.proposals);
      }
    });
    document.getElementById("btn-reload-proposals").addEventListener("click", () => {
      lastFetchTime = 0;
      loadProposalsByTab(true);
    });
    document.getElementById("btn-retry").addEventListener("click", loadProposalsByTab);
    bindTabEvents();
    const result = await chrome.storage.local.get("connectedAddress");
    if (result.connectedAddress) {
      appState.address = result.connectedAddress;
      showConnected(result.connectedAddress);
    } else {
      showState("disconnected");
    }
    updateOfflineBanner();
  }
  document.addEventListener("DOMContentLoaded", initialize);
})();
