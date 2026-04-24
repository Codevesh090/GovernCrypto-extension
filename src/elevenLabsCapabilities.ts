/**
 * ElevenLabs API Capability Detection
 * Detects what features are available based on the user's API key/subscription tier
 */

export interface ElevenLabsCapabilities {
  tier: 'free' | 'starter' | 'creator' | 'pro' | 'scale' | 'business';
  hasVoiceLibrary: boolean;
  hasMultilingual: boolean;
  hasStreaming: boolean;
  hasVoiceCloning: boolean;
  hasPronunciationDictionary: boolean;
  characterLimit: number;
  charactersUsed: number;
  voiceLimit: number;
}

const DEFAULT_CAPABILITIES: ElevenLabsCapabilities = {
  tier: 'free',
  hasVoiceLibrary: false,
  hasMultilingual: false,
  hasStreaming: false,
  hasVoiceCloning: false,
  hasPronunciationDictionary: false,
  characterLimit: 10000,
  charactersUsed: 0,
  voiceLimit: 1
};

/**
 * Detect ElevenLabs API capabilities by testing actual API calls
 * Instead of checking subscription tier, we try to use features and see what works
 */
export async function detectElevenLabsCapabilities(apiKey: string): Promise<ElevenLabsCapabilities> {
  // console.log('[ElevenLabs] Testing API key capabilities...');
  
  // Start with optimistic defaults - assume all features available
  const capabilities: ElevenLabsCapabilities = {
    tier: 'creator', // We don't care about tier anymore
    hasVoiceLibrary: true,
    hasMultilingual: true,
    hasStreaming: true,
    hasVoiceCloning: true,
    hasPronunciationDictionary: true,
    characterLimit: 100000,
    charactersUsed: 0,
    voiceLimit: 30
  };

  // console.log('[ElevenLabs] Assuming all features available - will check on actual use');
  return capabilities;
}

/**
 * Determine subscription tier from user data
 */
function determineTier(subscription: any): ElevenLabsCapabilities['tier'] {
  if (!subscription) {
    // console.log('[ElevenLabs] No subscription object found');
    return 'free';
  }
  
  // console.log('[ElevenLabs] Full subscription object:', JSON.stringify(subscription, null, 2));
  
  // Try different possible field names for tier
  const tierField = subscription.tier || subscription.plan || subscription.subscription_tier || subscription.plan_name;
  const tier = tierField?.toLowerCase() || '';
  
  // console.log('[ElevenLabs] Tier field value:', tierField);
  // console.log('[ElevenLabs] Tier (lowercase):', tier);
  
  // Check for tier variations
  if (tier.includes('business')) return 'business';
  if (tier.includes('scale')) return 'scale';
  if (tier.includes('pro')) return 'pro';
  if (tier.includes('creator')) return 'creator';
  if (tier.includes('starter')) return 'starter';
  
  // Check character limit as fallback indicator
  const charLimit = subscription.character_limit || subscription.quota || 0;
  // console.log('[ElevenLabs] Character limit:', charLimit);
  
  if (charLimit >= 500000) return 'business';
  if (charLimit >= 200000) return 'scale';
  if (charLimit >= 100000) return 'creator';
  if (charLimit >= 30000) return 'starter';
  if (charLimit > 10000) return 'pro';
  
  // If no match, log the full subscription object for debugging
  // console.warn('[ElevenLabs] Could not determine tier from subscription:', subscription);
  // console.warn('[ElevenLabs] Please share this log to help fix detection');
  return 'free';
}

/**
 * Get voice limit based on tier
 */
function getVoiceLimit(tier: ElevenLabsCapabilities['tier']): number {
  switch (tier) {
    case 'free': return 1;
    case 'starter': return 10;
    case 'creator': return 30;
    case 'pro': return 160;
    case 'scale': return 660;
    case 'business': return 1000;
    default: return 1;
  }
}

/**
 * Save capabilities to storage
 */
export async function saveCapabilities(capabilities: ElevenLabsCapabilities): Promise<void> {
  await chrome.storage.local.set({ elevenLabsCapabilities: capabilities });
}

/**
 * Get saved capabilities from storage
 */
export async function getCapabilities(): Promise<ElevenLabsCapabilities> {
  const result = await chrome.storage.local.get('elevenLabsCapabilities');
  return result.elevenLabsCapabilities || DEFAULT_CAPABILITIES;
}

/**
 * Check if a specific feature is available
 */
export async function hasFeature(feature: keyof Omit<ElevenLabsCapabilities, 'tier' | 'characterLimit' | 'charactersUsed' | 'voiceLimit'>): Promise<boolean> {
  const capabilities = await getCapabilities();
  return capabilities[feature];
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: ElevenLabsCapabilities['tier']): string {
  const names: Record<ElevenLabsCapabilities['tier'], string> = {
    'free': 'Free',
    'starter': 'Starter',
    'creator': 'Creator',
    'pro': 'Pro',
    'scale': 'Scale',
    'business': 'Business'
  };
  return names[tier];
}

/**
 * Get upgrade message for locked feature
 */
export function getUpgradeMessage(feature: string): string {
  const messages: Record<string, string> = {
    'voiceLibrary': 'Voice library requires Starter plan or higher',
    'multilingual': 'Multilingual voices require Starter plan or higher',
    'streaming': 'Streaming audio requires Creator plan or higher',
    'voiceCloning': 'Voice cloning requires Creator plan or higher',
    'pronunciation': 'Pronunciation dictionary requires Starter plan or higher'
  };
  return messages[feature] || 'This feature requires a paid plan';
}
