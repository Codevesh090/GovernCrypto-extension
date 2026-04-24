/**
 * Feature 4: Voice AI — Conversational engine (Mistral + proposal context)
 *
 * Uses callMistral directly with a system prompt — does NOT go through
 * generateSummary, so Mistral answers questions instead of formatting summaries.
 */

import { callMistral } from './mistral.js';
import { DisplayProposal } from './proposals.js';
import { detectLanguage, getLanguageName } from './languageDetection.js';
import { normalizeForSpeech } from './speechNormalizer.js';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

// Per-session state
let conversationHistory: Turn[] = [];
let currentProposalContext = '';

/**
 * Strips all markdown so TTS reads clean plain text.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/^>\s*/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Call this when a proposal detail screen opens.
 * Stores the proposal as context for the conversation session.
 */
export function initConversation(proposal: DisplayProposal): void {
  conversationHistory = [];
  currentProposalContext = `PROPOSAL TITLE: ${proposal.title}

PROPOSAL BODY:
${proposal.bodyFull || proposal.bodyDetail}`;
}

/**
 * Resets conversation memory. Call when navigating away from a proposal.
 */
export function resetConversation(): void {
  conversationHistory = [];
  currentProposalContext = '';
}

/**
 * Asks Mistral a question about the current proposal.
 * Uses proper system/user/assistant message format.
 * Returns clean plain text (no markdown) suitable for TTS.
 */
export async function askAboutProposal(
  question: string,
  mistralApiKey: string,
  forcedLanguage?: string
): Promise<string> {
  if (!currentProposalContext) {
    return 'No proposal loaded. Please open a proposal first.';
  }

  // Use forced language if set, otherwise auto-detect
  const detectedLanguage = forcedLanguage || detectLanguage(question);
  const languageName = getLanguageName(detectedLanguage);
  
  // console.log('[Voice Conversation] Language:', detectedLanguage, '(' + languageName + ')', forcedLanguage ? '[FORCED]' : '[auto-detected]');

  // Build language-aware system prompt with TTS-friendly instructions
  let languageInstruction = '';
  let ttsInstructions = '';
  
  if (detectedLanguage === 'en') {
    languageInstruction = 'Respond in English.';
    ttsInstructions = `
- Write numbers in words when they are small (1-20), otherwise use digits that can be read naturally.
- Write currency amounts in a speakable way: "$1000" should be "one thousand dollars".
- Avoid symbols like $, %, #, @, &, etc. Write them out in words.`;
  } else if (detectedLanguage === 'hinglish') {
    languageInstruction = 'The user wants a Hinglish response. Respond in Hinglish — a natural mix of Hindi and English words as spoken in India. Use Roman script (not Devanagari). Mix Hindi and English naturally like a native Hinglish speaker would. For example: "Yeh proposal basically ek naya system introduce karta hai jo governance ko improve karega."';
    ttsInstructions = `
- Write in Roman script Hinglish (mix of Hindi and English words).
- Numbers can be in English digits or Hindi words, whichever sounds more natural.
- Keep it conversational and natural-sounding.`;
  } else {
    languageInstruction = `The user is asking in ${languageName}. You MUST respond entirely in ${languageName}. Do NOT mix English words or phrases. Do NOT use English examples like "Think of it like...". Use ${languageName} for everything including examples and analogies.`;
    
    // Language-specific TTS instructions
    if (detectedLanguage === 'hi') {
      ttsInstructions = `
- Write ALL numbers in ${languageName} words, not digits. Examples:
  * "1000" should be "ek hazar"
  * "50%" should be "pachaas pratishat"
  * "$1000" should be "ek hazar dollar" or "ek hazar rupaye"
  * "2024" should be "do hazar chaubees"
- Write ALL symbols in ${languageName} words:
  * "$" should be "dollar" or "rupaye"
  * "%" should be "pratishat"
  * "#" should be "number" or "sankhya"
  * "@" should be "at" or "par"
- Avoid English words completely. Use ${languageName} equivalents:
  * "proposal" → "prastav"
  * "vote" → "mat"
  * "governance" → "shasan"
- Write technical terms in simple ${languageName} that can be spoken naturally.
- Do NOT use romanized ${languageName} words like "samajh" - use Devanagari script or simple spoken equivalents.`;
    } else if (detectedLanguage === 'es') {
      ttsInstructions = `
- Write ALL numbers in ${languageName} words: "1000" → "mil", "$1000" → "mil dólares"
- Write symbols in words: "$" → "dólares", "%" → "por ciento"
- Use natural Spanish phrasing that sounds good when spoken aloud.`;
    } else if (detectedLanguage === 'fr') {
      ttsInstructions = `
- Write ALL numbers in ${languageName} words: "1000" → "mille", "$1000" → "mille dollars"
- Write symbols in words: "$" → "dollars", "%" → "pour cent"
- Use natural French phrasing that sounds good when spoken aloud.`;
    } else if (detectedLanguage === 'de') {
      ttsInstructions = `
- Write ALL numbers in ${languageName} words: "1000" → "tausend", "$1000" → "tausend Dollar"
- Write symbols in words: "$" → "Dollar", "%" → "Prozent"
- Use natural German phrasing that sounds good when spoken aloud.`;
    } else {
      // Generic instructions for other languages
      ttsInstructions = `
- Write ALL numbers in ${languageName} words, not digits.
- Write ALL symbols ($, %, #, @, etc.) in ${languageName} words.
- Use natural ${languageName} phrasing that sounds good when spoken aloud.
- Avoid technical jargon - use simple, speakable ${languageName}.`;
    }
  }

  const systemPrompt = `You are a friendly DAO governance assistant having a voice conversation with a user. They're asking you questions about a specific governance proposal.

CRITICAL - CONVERSATIONAL VOICE STYLE:
- Speak naturally like you're having a real conversation, not reading a document
- Use simple, everyday language that sounds good when spoken aloud
- Be warm, helpful, and engaging
- Avoid formal or written language - speak like a knowledgeable friend

TEXT-TO-SPEECH OPTIMIZATION:
Your response will be read aloud by a text-to-speech engine. Keep it speakable:
${ttsInstructions}

CONVERSATION RULES:
- Answer ONLY based on the proposal information provided below
- Give answers that are 3 to 5 sentences long - conversational but complete
- If the user asks to understand or explain the proposal, give a clear explanation AND a real-world analogy
- If the user asks a specific question, answer it directly and add one sentence of useful context
- NEVER use markdown, asterisks, bullet points, bold, italic, hashtags, or special characters
- Write in plain spoken language only - imagine you're speaking, not writing
- Do not start with "Sure", "Of course", "Great question", or "Certainly"
- ${languageInstruction}

${currentProposalContext}`;

  // Build messages array with rolling history
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  // Add last 3 turns of history for context
  const recentHistory = conversationHistory.slice(-6);
  for (const turn of recentHistory) {
    messages.push({ role: turn.role as 'user' | 'assistant', content: turn.content });
  }

  messages.push({ role: 'user', content: question });

  const rawResponse = await callMistral(messages, mistralApiKey, 400);
  const cleanResponse = stripMarkdownForSpeech(rawResponse);
  
  // Detect language from the response
  const responseLanguage = detectLanguage(cleanResponse);
  // console.log('[Voice Conversation] Detected response language:', responseLanguage);
  
  // Normalize for speech (convert numbers, currency, acronyms to speakable forms)
  const normalizedResponse = normalizeForSpeech(cleanResponse, responseLanguage);
  // console.log('[Voice Conversation] Normalized response preview:', normalizedResponse.substring(0, 100) + '...');

  // Update rolling memory with normalized response
  conversationHistory.push({ role: 'user',      content: question });
  conversationHistory.push({ role: 'assistant', content: normalizedResponse });
  if (conversationHistory.length > 8) {
    conversationHistory = conversationHistory.slice(-8);
  }

  return normalizedResponse;
}
