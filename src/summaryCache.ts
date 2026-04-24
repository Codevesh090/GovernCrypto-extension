const CACHE_PREFIX = 'summary_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedSummary(proposalId: string, language: string = 'en'): Promise<string | null> {
  try {
    const key = `${CACHE_PREFIX}${language}_${proposalId}`;
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

export async function cacheSummary(proposalId: string, summary: string, language: string = 'en'): Promise<void> {
  try {
    const key = `${CACHE_PREFIX}${language}_${proposalId}`;
    const entry = JSON.stringify({ summary, createdAt: Date.now() });
    await chrome.storage.local.set({ [key]: entry });
  } catch {
    // non-fatal
  }
}

export async function clearAllSummaries(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const summaryKeys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
  if (summaryKeys.length > 0) {
    await chrome.storage.local.remove(summaryKeys);
  }
}
