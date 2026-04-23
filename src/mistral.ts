const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-latest';

const TIMEOUT_MS = 10000;

const SYSTEM_PROMPT = `You are summarizing a DAO governance proposal for a Chrome extension UI. The user is a token holder who wants to understand what they're voting on quickly.

You MUST format your response EXACTLY like this. Do not add any extra text, preamble, or explanation outside of these 6 sections:

**What this proposal wants:**
[1-2 sentences, plain English, what is being asked]

**Why it matters:**
[2-3 sentences, the problem it solves or the impact it has]

**In simple terms:**
> [One punchy quote that captures the whole proposal in one line]

**Vote type:**
[Either "Signal only — a final onchain vote will follow" or "Onchain — this directly executes if passed"]

**What a YES vote means:**
[1 sentence — concrete outcome if passed]

**What a NO vote means:**
[1 sentence — what stays the same if rejected]

STRICT RULES — follow every one:
- Output ONLY the 6 sections above, nothing else before or after
- Use EXACTLY the heading labels shown, with ** on both sides
- No crypto jargon unless unavoidable
- No bullet point lists inside sections
- Total length: 100-130 words maximum
- Always include all 6 sections completely — never skip or merge sections
- If the proposal has multiple numbered points, identify the single most important outcome and lead with that
- If a budget or funding amount is mentioned, include the exact figure in the YES vote outcome
- Ignore legal disclaimers, indemnification clauses, and committee appointment details
- Ignore internal tables and wallet balances — summarize the net ask only
- If the proposal body is empty or under 20 words, respond with exactly: "No description provided for this proposal."`;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Saves the Mistral API key to chrome.storage.local.
 */
export async function saveMistralApiKey(apiKey: string): Promise<void> {
  await chrome.storage.local.set({ mistralApiKey: apiKey });
}

/**
 * Retrieves the Mistral API key from chrome.storage.local.
 */
export async function getMistralApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('mistralApiKey');
  return result.mistralApiKey || null;
}

/**
 * Retrieves the ElevenLabs API key from chrome.storage.local.
 */
export async function getElevenLabsApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('elevenLabsApiKey');
  return result.elevenLabsApiKey || null;
}

/**
 * Low-level Mistral call with custom messages array.
 * Used by voice conversation — does NOT inject the summary system prompt.
 */
export async function callMistral(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  apiKey: string,
  maxTokens = 300
): Promise<string> {
  const requestBody = JSON.stringify({
    model: MISTRAL_MODEL,
    messages,
    temperature: 0.4,
    max_tokens: maxTokens
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body:   requestBody
      });

      clearTimeout(timeoutId);

      if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Mistral API error: ${response.status} — ${errorBody}`);
      }

      const json = await response.json();
      const text = json?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Mistral returned empty response');
      return text.trim();

    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('Request timed out');
      if (attempt < MAX_RETRIES && !err.message?.includes('Mistral API error')) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Mistral API failed after maximum retries');
}

/**
 * Sends proposal body to Mistral and returns the formatted summary string.
 * Retries on 503/429 with exponential backoff.
 */
export async function generateSummary(proposalBody: string, apiKey: string): Promise<string> {
  if (!proposalBody || proposalBody.trim().length < 20) {
    return 'No description provided for this proposal.';
  }

  const requestBody = JSON.stringify({
    model: MISTRAL_MODEL,
    messages: [
      {
        role: 'user',
        content: `${SYSTEM_PROMPT}\n\nProposal to summarize:\n${proposalBody}`
      }
    ],
    temperature: 0.3,
    max_tokens: 600
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    console.log(`[Mistral] Attempt ${attempt}/${MAX_RETRIES} — sending request to:`, MISTRAL_ENDPOINT);
    console.log('[Mistral] Request body:', requestBody);

    try {
      const response = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: requestBody
      });

      clearTimeout(timeoutId);

      console.log(`[Mistral] Response status: ${response.status} ${response.statusText}`);

      // 503/429 = overloaded or rate limited, retry with backoff
      if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        console.warn(`[Mistral] ${response.status} received, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '(could not read error body)');
        console.error(`[Mistral] Error response body:`, errorBody);
        throw new Error(`Mistral API error: ${response.status} — ${errorBody}`);
      }

      const json = await response.json();
      console.log('[Mistral] Response JSON:', JSON.stringify(json, null, 2));

      const text = json?.choices?.[0]?.message?.content;

      if (!text) {
        console.error('[Mistral] Empty text in response. Full JSON:', json);
        throw new Error('Mistral returned empty response');
      }

      return text.trim();

    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('[Mistral] Request timed out');
        throw new Error('Request timed out');
      }
      if (attempt < MAX_RETRIES && !(err.message?.includes('Mistral API error'))) {
        console.warn(`[Mistral] Attempt ${attempt} failed: ${err.message}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Mistral API failed after maximum retries');
}
