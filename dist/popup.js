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
      end: raw.end || 0,
      bodyFull: stripMarkdown(raw.body || "").slice(0, 3e3)
      // up to 3000 chars for AI summary
    };
  }

  // src/mistral.ts
  var MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
  var MISTRAL_MODEL = "mistral-small-latest";
  var TIMEOUT_MS = 1e4;
  var SYSTEM_PROMPT = `You are summarizing a DAO governance proposal for a Chrome extension UI. The user is a token holder who wants to understand what they're voting on quickly.

You MUST format your response EXACTLY like this. Do not add any extra text, preamble, or explanation outside of these 6 sections:

**What this proposal wants:**
[1-2 sentences, plain English, what is being asked]

**Why it matters:**
[2-3 sentences, the problem it solves or the impact it has]

**In simple terms:**
> [One punchy quote that captures the whole proposal in one line]

**Vote type:**
[Either "Signal only \u2014 a final onchain vote will follow" or "Onchain \u2014 this directly executes if passed"]

**What a YES vote means:**
[1 sentence \u2014 concrete outcome if passed]

**What a NO vote means:**
[1 sentence \u2014 what stays the same if rejected]

STRICT RULES \u2014 follow every one:
- Output ONLY the 6 sections above, nothing else before or after
- Use EXACTLY the heading labels shown, with ** on both sides
- No crypto jargon unless unavoidable
- No bullet point lists inside sections
- Total length: 100-130 words maximum
- Always include all 6 sections completely \u2014 never skip or merge sections
- If the proposal has multiple numbered points, identify the single most important outcome and lead with that
- If a budget or funding amount is mentioned, include the exact figure in the YES vote outcome
- Ignore legal disclaimers, indemnification clauses, and committee appointment details
- Ignore internal tables and wallet balances \u2014 summarize the net ask only
- If the proposal body is empty or under 20 words, respond with exactly: "No description provided for this proposal."`;
  var MAX_RETRIES = 3;
  var RETRY_DELAY_MS = 1e3;
  async function saveMistralApiKey(apiKey) {
    await chrome.storage.local.set({ mistralApiKey: apiKey });
  }
  async function getMistralApiKey() {
    const result = await chrome.storage.local.get("mistralApiKey");
    return result.mistralApiKey || null;
  }
  async function getElevenLabsApiKey() {
    const result = await chrome.storage.local.get("elevenLabsApiKey");
    return result.elevenLabsApiKey || null;
  }
  async function callMistral(messages, apiKey, maxTokens = 300) {
    const requestBody = JSON.stringify({
      model: MISTRAL_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: maxTokens
    });
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(MISTRAL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          signal: controller.signal,
          body: requestBody
        });
        clearTimeout(timeoutId);
        if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          throw new Error(`Mistral API error: ${response.status} \u2014 ${errorBody}`);
        }
        const json = await response.json();
        const text = json?.choices?.[0]?.message?.content;
        if (!text) throw new Error("Mistral returned empty response");
        return text.trim();
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") throw new Error("Request timed out");
        if (attempt < MAX_RETRIES && !err.message?.includes("Mistral API error")) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Mistral API failed after maximum retries");
  }
  async function generateSummary(proposalBody, apiKey) {
    if (!proposalBody || proposalBody.trim().length < 20) {
      return "No description provided for this proposal.";
    }
    const requestBody = JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}

Proposal to summarize:
${proposalBody}`
        }
      ],
      temperature: 0.3,
      max_tokens: 600
    });
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      console.log(`[Mistral] Attempt ${attempt}/${MAX_RETRIES} \u2014 sending request to:`, MISTRAL_ENDPOINT);
      console.log("[Mistral] Request body:", requestBody);
      try {
        const response = await fetch(MISTRAL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          signal: controller.signal,
          body: requestBody
        });
        clearTimeout(timeoutId);
        console.log(`[Mistral] Response status: ${response.status} ${response.statusText}`);
        if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt;
          console.warn(`[Mistral] ${response.status} received, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        if (!response.ok) {
          const errorBody = await response.text().catch(() => "(could not read error body)");
          console.error(`[Mistral] Error response body:`, errorBody);
          throw new Error(`Mistral API error: ${response.status} \u2014 ${errorBody}`);
        }
        const json = await response.json();
        console.log("[Mistral] Response JSON:", JSON.stringify(json, null, 2));
        const text = json?.choices?.[0]?.message?.content;
        if (!text) {
          console.error("[Mistral] Empty text in response. Full JSON:", json);
          throw new Error("Mistral returned empty response");
        }
        return text.trim();
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          console.error("[Mistral] Request timed out");
          throw new Error("Request timed out");
        }
        if (attempt < MAX_RETRIES && !err.message?.includes("Mistral API error")) {
          console.warn(`[Mistral] Attempt ${attempt} failed: ${err.message}, retrying...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Mistral API failed after maximum retries");
  }

  // src/summaryCache.ts
  var CACHE_PREFIX = "summary_";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  async function getCachedSummary(proposalId) {
    try {
      const key = CACHE_PREFIX + proposalId;
      const result = await chrome.storage.local.get(key);
      if (!result[key]) return null;
      const entry = JSON.parse(result[key]);
      if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
        await chrome.storage.local.remove(key);
        return null;
      }
      return entry.summary;
    } catch {
      return null;
    }
  }
  async function cacheSummary(proposalId, summary) {
    try {
      const key = CACHE_PREFIX + proposalId;
      const entry = JSON.stringify({ summary, createdAt: Date.now() });
      await chrome.storage.local.set({ [key]: entry });
    } catch {
    }
  }

  // src/summaryRenderer.ts
  var SUMMARY_HEADINGS = [
    "**What this proposal wants:**",
    "**Why it matters:**",
    "**In simple terms:**",
    "**Vote type:**",
    "**What a YES vote means:**",
    "**What a NO vote means:**"
  ];
  function parseSummary(summaryText) {
    if (!summaryText || !summaryText.trim()) return [];
    const sections = [];
    const lines = summaryText.split("\n");
    let currentHeading = null;
    let currentContent = [];
    for (const line of lines) {
      const trimmed = line.trim().replace(/\s+/g, " ");
      if (!trimmed) continue;
      const matchedHeading = SUMMARY_HEADINGS.find(
        (h) => trimmed.toLowerCase().startsWith(h.toLowerCase())
      );
      if (matchedHeading) {
        if (currentHeading !== null) {
          sections.push({
            heading: currentHeading.replace(/\*\*/g, "").trim(),
            content: currentContent.join(" ").trim()
          });
        }
        currentHeading = matchedHeading;
        currentContent = [];
        const inline = trimmed.slice(matchedHeading.length).trim();
        if (inline) currentContent.push(inline);
      } else if (currentHeading !== null) {
        const contentLine = trimmed.startsWith(">") ? trimmed.slice(1).trim() : trimmed;
        if (contentLine) currentContent.push(contentLine);
      }
    }
    if (currentHeading !== null) {
      sections.push({
        heading: currentHeading.replace(/\*\*/g, "").trim(),
        content: currentContent.join(" ").trim()
      });
    }
    return sections;
  }
  function renderSummary(sections, containerEl) {
    containerEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const section of sections) {
      const wrapper = document.createElement("div");
      wrapper.className = "summary-section";
      const heading = document.createElement("span");
      heading.className = "summary-heading";
      heading.textContent = section.heading;
      const content = document.createElement("p");
      content.className = "summary-content";
      const headingLower = section.heading.toLowerCase();
      if (headingLower.includes("in simple terms")) {
        content.className += " summary-quote";
        content.textContent = section.content;
      } else if (headingLower.includes("yes vote")) {
        const tag = document.createElement("span");
        tag.className = "vote-tag vote-tag-yes";
        tag.textContent = "YES";
        content.appendChild(tag);
        content.appendChild(document.createTextNode(section.content));
      } else if (headingLower.includes("no vote")) {
        const tag = document.createElement("span");
        tag.className = "vote-tag vote-tag-no";
        tag.textContent = "NO";
        content.appendChild(tag);
        content.appendChild(document.createTextNode(section.content));
      } else {
        content.textContent = section.content;
      }
      wrapper.appendChild(heading);
      wrapper.appendChild(content);
      fragment.appendChild(wrapper);
    }
    containerEl.appendChild(fragment);
  }
  function getFallbackSummary(bodyText) {
    if (!bodyText || bodyText.trim().length === 0) {
      return "No description available for this proposal.";
    }
    const sentences = bodyText.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const first3 = sentences.slice(0, 3).join(" ");
    const truncated = first3.length > 300 ? first3.slice(0, 300) + "..." : first3;
    return truncated || bodyText.slice(0, 300);
  }

  // src/voiceStt.ts
  function recordWithSpeechAPI(onTranscript, silenceMs = 2e3) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return {
        promise: Promise.reject(new Error("Speech recognition not supported in this browser.")),
        stop: () => {
        }
      };
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    let finalTranscript = "";
    let silenceTimer = null;
    let resolved = false;
    const promise = new Promise((resolve, reject) => {
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript + " ";
          } else {
            interim += result[0].transcript;
          }
        }
        onTranscript((finalTranscript + interim).trim(), false);
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
        silenceTimer = setTimeout(() => {
          recognition.stop();
        }, silenceMs);
      };
      recognition.onend = () => {
        if (resolved) return;
        resolved = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        const result = finalTranscript.trim();
        onTranscript(result, true);
        if (result) {
          resolve(result);
        } else {
          reject(new Error("No speech detected. Please try again."));
        }
      };
      recognition.onerror = (event) => {
        if (resolved) return;
        resolved = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        const msg = event.error === "not-allowed" ? "Microphone access denied. Click Allow when Chrome asks." : event.error === "no-speech" ? "No speech detected. Please try again." : event.error === "network" ? "Network error during speech recognition." : `Speech error: ${event.error}`;
        reject(new Error(msg));
      };
      try {
        recognition.start();
      } catch (err) {
        resolved = true;
        reject(new Error(`Could not start microphone: ${err.message}`));
      }
    });
    const stop = () => {
      if (!resolved) {
        try {
          recognition.stop();
        } catch {
        }
      }
    };
    return { promise, stop };
  }

  // src/voiceTts.ts
  var TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
  var DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
  var currentAudio = null;
  function stopSpeaking() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
      currentAudio = null;
    }
  }
  async function speakTextStream(text, apiKey, voiceId = DEFAULT_VOICE_ID) {
    stopSpeaking();
    const res = await fetch(`${TTS_BASE}/${voiceId}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.7
        }
      })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`TTS error ${res.status}: ${err}`);
    }
    const reader = res.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const blob = new Blob(chunks, { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    await new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        reject(new Error("Audio playback error"));
      };
      audio.play().catch(reject);
    });
  }

  // src/voiceConversation.ts
  var conversationHistory = [];
  var currentProposalContext = "";
  function stripMarkdownForSpeech(text) {
    return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,6}\s+/g, "").replace(/^>\s*/gm, "").replace(/`{1,3}[^`]*`{1,3}/g, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\n{2,}/g, " ").replace(/\n/g, " ").trim();
  }
  function initConversation(proposal) {
    conversationHistory = [];
    currentProposalContext = `PROPOSAL TITLE: ${proposal.title}

PROPOSAL BODY:
${proposal.bodyFull || proposal.bodyDetail}`;
  }
  function resetConversation() {
    conversationHistory = [];
    currentProposalContext = "";
  }
  async function askAboutProposal(question, mistralApiKey) {
    if (!currentProposalContext) {
      return "No proposal loaded. Please open a proposal first.";
    }
    const systemPrompt = `You are a DAO governance assistant. A user is asking you questions about a specific governance proposal using voice.

RULES:
- Answer ONLY based on the proposal information provided below.
- If the question is unrelated to this proposal, say: "I can only help you understand this proposal."
- Be conversational, warm, and clear \u2014 like a knowledgeable friend explaining something important.
- Give answers that are 3 to 5 sentences long. Never give one-sentence answers.
- If the user asks to understand, explain, or summarize the proposal, give a thorough explanation AND include a real-world analogy or example to make it concrete. For example: "Think of it like..." or "A simple way to picture this is..."
- If the user asks a specific question, answer it directly and then add one sentence of useful context.
- NEVER use markdown, asterisks, bullet points, bold, italic, hashtags, or any special characters.
- Write in plain spoken English only. Your response will be read aloud by a text-to-speech engine.
- Do not start your answer with "Sure", "Of course", "Great question", or "Certainly".
- Numbers and percentages are fine to say aloud.

${currentProposalContext}`;
    const messages = [
      { role: "system", content: systemPrompt }
    ];
    const recentHistory = conversationHistory.slice(-6);
    for (const turn of recentHistory) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: "user", content: question });
    const rawResponse = await callMistral(messages, mistralApiKey, 400);
    const cleanResponse = stripMarkdownForSpeech(rawResponse);
    conversationHistory.push({ role: "user", content: question });
    conversationHistory.push({ role: "assistant", content: cleanResponse });
    if (conversationHistory.length > 8) {
      conversationHistory = conversationHistory.slice(-8);
    }
    return cleanResponse;
  }

  // src/snapshotVote.ts
  var SNAPSHOT_DOMAIN = {
    name: "snapshot",
    version: "0.1.4",
    chainId: 1,
    verifyingContract: "0xC4cDb0a651724D7DB1b3b2F08b8bF61b5a33952D"
  };
  var VOTE_TYPE = [
    { name: "from", type: "address" },
    { name: "space", type: "string" },
    { name: "timestamp", type: "uint64" },
    { name: "proposal", type: "bytes32" },
    { name: "choice", type: "uint32" },
    { name: "reason", type: "string" },
    { name: "app", type: "string" },
    { name: "metadata", type: "string" }
  ];
  var SNAPSHOT_RELAY = "https://seq.snapshot.org/";
  function buildVotePayload(proposalId, spaceId, choiceIndex, voterAddress) {
    return {
      from: voterAddress,
      space: spaceId,
      timestamp: Math.floor(Date.now() / 1e3),
      proposal: proposalId,
      choice: choiceIndex,
      reason: "",
      app: "govercrypto",
      metadata: "{}",
      type: "vote"
    };
  }
  function buildTypedData(payload) {
    return {
      domain: SNAPSHOT_DOMAIN,
      types: { Vote: VOTE_TYPE },
      primaryType: "Vote",
      message: payload
    };
  }
  async function castVote(proposalId, spaceId, choiceIndex, voterAddress) {
    const payload = buildVotePayload(proposalId, spaceId, choiceIndex, voterAddress);
    const typedData = buildTypedData(payload);
    const ethereum = window.ethereum;
    if (!ethereum) {
      throw new Error("No wallet provider found");
    }
    let signature;
    try {
      signature = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [voterAddress, JSON.stringify(typedData)]
      });
    } catch (err) {
      if (err?.code === 4001 || err?.message?.toLowerCase().includes("user rejected")) {
        throw new Error("Signature rejected");
      }
      throw new Error(`Signing failed: ${err?.message || err}`);
    }
    let response;
    try {
      response = await fetch(SNAPSHOT_RELAY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: voterAddress,
          sig: signature,
          data: typedData
        })
      });
    } catch {
      throw new Error("Network error. Please try again.");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (body.toLowerCase().includes("already voted")) {
        throw new Error("You have already voted on this proposal");
      }
      throw new Error(`Relay error ${response.status}: ${body}`);
    }
    const json = await response.json().catch(() => ({}));
    if (json?.error?.toLowerCase?.().includes("already voted")) {
      throw new Error("You have already voted on this proposal");
    }
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
  var CACHE_TTL_MS2 = 60 * 60 * 1e3;
  var autoReloadTimer;
  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((el) => {
      el.style.display = "none";
    });
  }
  function renderCurrentScreen() {
    hideAllScreens();
    switch (appState.screen) {
      case "setup":
        document.getElementById("screen-setup").style.display = "flex";
        break;
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
        setVoiceState("idle");
        showVoiceTranscript("");
        initConversation(appState.selectedProposal);
        renderProposalDetail(appState.selectedProposal);
        loadAISummary(appState.selectedProposal);
        setTimeout(() => startWakeWordListener(), 500);
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
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.connectedAddress) {
      const newAddress = changes.connectedAddress.newValue;
      if (newAddress && appState.screen === "connect") {
        console.log("Wallet connected via storage change:", newAddress);
        isConnecting = false;
        appState.address = newAddress;
        showConnected(newAddress);
      }
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
  function showSetupError(msg) {
    const el = document.getElementById("setup-error");
    el.textContent = msg;
    el.style.display = "block";
  }
  function hideSetupError() {
    const el = document.getElementById("setup-error");
    el.style.display = "none";
  }
  async function saveApiKeys() {
    const mistral = document.getElementById("input-mistral-key").value.trim();
    const eleven = document.getElementById("input-elevenlabs").value.trim();
    if (!mistral || !eleven) {
      showSetupError("Both API keys are required.");
      return;
    }
    hideSetupError();
    await saveMistralApiKey(mistral);
    await chrome.storage.local.set({ elevenLabsApiKey: eleven });
    document.getElementById("input-mistral-key").value = "";
    document.getElementById("input-elevenlabs").value = "";
    navigate("connect");
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
    const summaryWrapper = document.createElement("div");
    summaryWrapper.id = "detail-summary-wrapper";
    summaryWrapper.style.cssText = "padding: 12px 16px 0;";
    const summaryBadge = document.createElement("div");
    summaryBadge.className = "summary-badge";
    summaryBadge.textContent = "\u26A1 AI Summary";
    const summaryLoading = document.createElement("div");
    summaryLoading.id = "summary-loading";
    summaryLoading.className = "summary-loading";
    summaryLoading.innerHTML = '<div class="summary-spinner"></div><span>AI is analyzing this proposal...</span>';
    const summaryError = document.createElement("div");
    summaryError.id = "summary-error";
    summaryError.className = "summary-error";
    summaryError.style.display = "none";
    summaryError.textContent = "Could not generate AI summary.";
    const summaryNoKey = document.createElement("div");
    summaryNoKey.id = "summary-no-key";
    summaryNoKey.className = "summary-error";
    summaryNoKey.style.display = "none";
    summaryNoKey.textContent = "Please add your Mistral API key in settings.";
    const summaryFallback = document.createElement("div");
    summaryFallback.id = "summary-fallback";
    summaryFallback.className = "summary-fallback";
    summaryFallback.style.display = "none";
    const summaryContent = document.createElement("div");
    summaryContent.id = "detail-summary";
    summaryContent.style.display = "none";
    summaryWrapper.appendChild(summaryBadge);
    summaryWrapper.appendChild(summaryLoading);
    summaryWrapper.appendChild(summaryError);
    summaryWrapper.appendChild(summaryNoKey);
    summaryWrapper.appendChild(summaryFallback);
    summaryWrapper.appendChild(summaryContent);
    container.appendChild(summaryWrapper);
    const summaryDivider = document.createElement("hr");
    summaryDivider.className = "summary-divider";
    container.appendChild(summaryDivider);
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
    const isActive = proposal.state === "active";
    proposal.choices.forEach((choice, idx) => {
      if (!choice) return;
      const btn = document.createElement("button");
      btn.className = "vote-btn";
      btn.textContent = choice;
      btn.disabled = !isActive;
      if (isActive) {
        btn.addEventListener(
          "click",
          () => handleVoteClick(proposal, idx + 1, voteButtons, voteStatus)
        );
      }
      voteButtons.appendChild(btn);
    });
    container.appendChild(voteButtons);
    const voteStatus = document.createElement("p");
    voteStatus.className = "vote-status";
    voteStatus.textContent = isActive ? "" : "Voting is closed for this proposal";
    container.appendChild(voteStatus);
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
    if (!forceReload && lastFetchTime && Date.now() - lastFetchTime < CACHE_TTL_MS2) {
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
      }, CACHE_TTL_MS2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load proposals";
      showProposalsError(msg);
    } finally {
      isLoadingProposals = false;
      reloadBtn?.classList.remove("loading");
    }
  }
  var MIN_LOADER_MS = 300;
  function resetSummarySection() {
    document.getElementById("summary-loading").style.display = "flex";
    document.getElementById("summary-error").style.display = "none";
    document.getElementById("summary-no-key").style.display = "none";
    document.getElementById("summary-fallback").style.display = "none";
    document.getElementById("detail-summary").style.display = "none";
  }
  function showSummaryNoKey() {
    document.getElementById("summary-loading").style.display = "none";
    document.getElementById("summary-no-key").style.display = "block";
  }
  function showSummaryError(fallbackText) {
    document.getElementById("summary-loading").style.display = "none";
    document.getElementById("summary-error").style.display = "block";
    if (fallbackText) {
      const el = document.getElementById("summary-fallback");
      el.textContent = fallbackText;
      el.style.display = "block";
    }
  }
  async function holdMinLoader(loadStart) {
    const elapsed = Date.now() - loadStart;
    if (elapsed < MIN_LOADER_MS) {
      await new Promise((r) => setTimeout(r, MIN_LOADER_MS - elapsed));
    }
  }
  async function loadAISummary(proposal) {
    resetSummarySection();
    const loadStart = Date.now();
    const apiKey = await getMistralApiKey();
    if (!apiKey) {
      await holdMinLoader(loadStart);
      showSummaryNoKey();
      return;
    }
    let summary = await getCachedSummary(proposal.id);
    if (!summary) {
      try {
        summary = await generateSummary(proposal.bodyFull, apiKey);
        await cacheSummary(proposal.id, summary);
      } catch (err) {
        console.error("AI Summary generation failed:", err);
        await holdMinLoader(loadStart);
        showSummaryError(getFallbackSummary(proposal.bodyFull));
        return;
      }
    }
    await holdMinLoader(loadStart);
    const sections = parseSummary(summary);
    const container = document.getElementById("detail-summary");
    renderSummary(sections, container);
    document.getElementById("summary-loading").style.display = "none";
    container.style.display = "block";
  }
  function setVoteButtons(container, disabled) {
    container.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.disabled = disabled;
    });
  }
  async function handleVoteClick(proposal, choiceIndex, buttonsContainer, statusEl) {
    const result = await chrome.storage.local.get("connectedAddress");
    const address = result.connectedAddress;
    if (!address) {
      statusEl.textContent = "Connect wallet first";
      statusEl.className = "vote-status error";
      return;
    }
    const choiceName = proposal.choices[choiceIndex - 1] || `Choice ${choiceIndex}`;
    const confirmed = window.confirm(`Vote "${choiceName}" on:
"${proposal.title}"?`);
    if (!confirmed) return;
    setVoteButtons(buttonsContainer, true);
    statusEl.textContent = "Submitting vote...";
    statusEl.className = "vote-status loading";
    try {
      await castVote(proposal.id, proposal.spaceId, choiceIndex, address);
      statusEl.textContent = "Vote submitted successfully \u2705";
      statusEl.className = "vote-status success";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Vote failed. Please try again.";
      if (msg.includes("already voted")) {
        statusEl.textContent = "You have already voted on this proposal";
        statusEl.className = "vote-status error";
      } else if (msg === "Signature rejected") {
        statusEl.textContent = "Signature rejected";
        statusEl.className = "vote-status error";
        setVoteButtons(buttonsContainer, false);
      } else {
        statusEl.textContent = "Vote failed. Please try again.";
        statusEl.className = "vote-status error";
        setVoteButtons(buttonsContainer, false);
      }
    }
  }
  var voiceState = "idle";
  var stopRecording = null;
  var wakeWordRecognition = null;
  var WAKE_WORD = "propo";
  function startWakeWordListener() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (wakeWordRecognition) return;
    wakeWordRecognition = new SpeechRecognition();
    wakeWordRecognition.continuous = true;
    wakeWordRecognition.interimResults = true;
    wakeWordRecognition.lang = "en-US";
    wakeWordRecognition.onresult = (event) => {
      if (voiceState !== "idle") return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (text.includes(WAKE_WORD)) {
          stopWakeWordListener();
          handleVoiceButtonClick();
          break;
        }
      }
    };
    wakeWordRecognition.onend = () => {
      if (appState.screen === "detail" && voiceState === "idle" && wakeWordRecognition) {
        try {
          wakeWordRecognition.start();
        } catch {
        }
      }
    };
    wakeWordRecognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wakeWordRecognition = null;
    };
    try {
      wakeWordRecognition.start();
      const statusEl = document.getElementById("voice-status");
      if (statusEl && voiceState === "idle") {
        statusEl.textContent = 'Say "Propo" or tap to ask AI';
      }
    } catch {
      wakeWordRecognition = null;
    }
  }
  function stopWakeWordListener() {
    if (wakeWordRecognition) {
      try {
        wakeWordRecognition.stop();
      } catch {
      }
      wakeWordRecognition = null;
    }
  }
  function playChime(type) {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === "open") {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(1e-3, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(1e-3, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      }
      osc.onended = () => ctx.close();
    } catch {
    }
  }
  function setVoiceState(state) {
    voiceState = state;
    const btn = document.getElementById("btn-voice");
    const statusEl = document.getElementById("voice-status");
    if (!btn || !statusEl) return;
    btn.disabled = false;
    btn.className = "";
    statusEl.className = "";
    switch (state) {
      case "idle":
        btn.textContent = "\u{1F399}\uFE0F Ask AI";
        statusEl.textContent = 'Say "Propo" or tap to ask AI';
        setTimeout(() => startWakeWordListener(), 300);
        break;
      case "recording":
        btn.textContent = "\u23F9 Stop";
        btn.classList.add("recording");
        statusEl.textContent = "\u{1F534} Listening...";
        statusEl.classList.add("status-recording");
        break;
      case "thinking":
        btn.textContent = "\u23F3 Thinking...";
        btn.disabled = true;
        statusEl.textContent = "AI is thinking...";
        statusEl.classList.add("status-thinking");
        break;
      case "speaking":
        btn.textContent = "\u23F9 Stop";
        btn.classList.add("speaking");
        statusEl.textContent = "\u{1F50A} Speaking...";
        statusEl.classList.add("status-speaking");
        break;
    }
  }
  function showVoiceTranscript(text) {
    const el = document.getElementById("voice-transcript");
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? "block" : "none";
  }
  function showVoiceError(msg) {
    const statusEl = document.getElementById("voice-status");
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.className = "status-error";
    }
    stopRecording = null;
    setVoiceState("idle");
  }
  async function handleVoiceButtonClick() {
    if (voiceState === "speaking") {
      stopSpeaking();
      setVoiceState("idle");
      return;
    }
    if (voiceState === "recording") {
      stopRecording?.();
      return;
    }
    if (voiceState !== "idle") return;
    const proposal = appState.selectedProposal;
    if (!proposal) return;
    const elevenKey = await getElevenLabsApiKey();
    const mistralKey = await getMistralApiKey();
    if (!elevenKey || !mistralKey) {
      showVoiceError("API keys missing \u2014 check setup.");
      return;
    }
    setVoiceState("recording");
    showVoiceTranscript("");
    stopWakeWordListener();
    playChime("open");
    const { promise, stop } = recordWithSpeechAPI(
      (interim, _isFinal) => {
        if (interim) showVoiceTranscript(interim);
      },
      2e3
    );
    stopRecording = stop;
    let transcript;
    try {
      transcript = await promise;
    } catch (err) {
      console.error("[Voice] Recording failed:", err);
      showVoiceError(err?.message || "Microphone access denied or unavailable.");
      return;
    } finally {
      stopRecording = null;
      playChime("close");
    }
    if (!transcript) {
      showVoiceError("No speech detected. Try again.");
      setVoiceState("idle");
      return;
    }
    showVoiceTranscript(`"${transcript}"`);
    setVoiceState("thinking");
    let answer;
    try {
      answer = await askAboutProposal(transcript, mistralKey);
    } catch (err) {
      console.error("[Voice] Mistral failed:", err);
      showVoiceError("AI response failed. Try again.");
      return;
    }
    setVoiceState("speaking");
    try {
      await speakTextStream(answer, elevenKey);
    } catch (err) {
      console.error("[Voice] TTS failed:", err);
      showVoiceError("Could not play audio response.");
      return;
    }
    setVoiceState("idle");
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
    document.getElementById("btn-save-keys").addEventListener("click", saveApiKeys);
    document.getElementById("input-elevenlabs").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveApiKeys();
    });
    document.getElementById("input-mistral-key").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveApiKeys();
    });
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
      stopSpeaking();
      stopWakeWordListener();
      resetConversation();
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
    document.getElementById("btn-voice").addEventListener("click", handleVoiceButtonClick);
    bindTabEvents();
    const keysData = await chrome.storage.local.get(["mistralApiKey", "elevenLabsApiKey"]);
    if (!keysData.mistralApiKey || !keysData.elevenLabsApiKey) {
      navigate("setup");
      updateOfflineBanner();
      return;
    }
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
