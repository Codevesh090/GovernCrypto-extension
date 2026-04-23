/**
 * Feature 4: Voice AI — Conversational engine (Mistral + proposal context)
 *
 * Uses callMistral directly with a system prompt — does NOT go through
 * generateSummary, so Mistral answers questions instead of formatting summaries.
 */

import { callMistral } from './mistral.js';
import { DisplayProposal } from './proposals.js';

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
  mistralApiKey: string
): Promise<string> {
  if (!currentProposalContext) {
    return 'No proposal loaded. Please open a proposal first.';
  }

  const systemPrompt = `You are a DAO governance assistant. A user is asking you questions about a specific governance proposal using voice.

RULES:
- Answer ONLY based on the proposal information provided below.
- If the question is unrelated to this proposal, say: "I can only help you understand this proposal."
- Be conversational, warm, and clear — like a knowledgeable friend explaining something important.
- Give answers that are 3 to 5 sentences long. Never give one-sentence answers.
- If the user asks to understand, explain, or summarize the proposal, give a thorough explanation AND include a real-world analogy or example to make it concrete. For example: "Think of it like..." or "A simple way to picture this is..."
- If the user asks a specific question, answer it directly and then add one sentence of useful context.
- NEVER use markdown, asterisks, bullet points, bold, italic, hashtags, or any special characters.
- Write in plain spoken English only. Your response will be read aloud by a text-to-speech engine.
- Do not start your answer with "Sure", "Of course", "Great question", or "Certainly".
- Numbers and percentages are fine to say aloud.

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

  // Update rolling memory
  conversationHistory.push({ role: 'user',      content: question });
  conversationHistory.push({ role: 'assistant', content: cleanResponse });
  if (conversationHistory.length > 8) {
    conversationHistory = conversationHistory.slice(-8);
  }

  return cleanResponse;
}
