/**
 * Voice Settings Management
 * Handles user preferences for voice, speed, and audio settings
 */

export interface VoiceSettings {
  selectedVoiceId: string;
  voiceName: string;
  speechSpeed: number; // 0.5 to 2.0
  soundEffectsEnabled: boolean;
  voiceLanguage: string; // ISO code
}

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels: {
    accent?: string;
    description?: string;
    age?: string;
    gender?: string;
  };
  preview_url?: string;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  selectedVoiceId: 'EXAVITQu4vr4xnSDxMaL', // Default ElevenLabs voice (Sarah)
  voiceName: 'Sarah',
  speechSpeed: 1.0,
  soundEffectsEnabled: true,
  voiceLanguage: 'en'
};

/**
 * Get voice settings from storage
 */
export async function getVoiceSettings(): Promise<VoiceSettings> {
  const result = await chrome.storage.local.get('voiceSettings');
  return result.voiceSettings || DEFAULT_SETTINGS;
}

/**
 * Save voice settings to storage
 */
export async function saveVoiceSettings(settings: Partial<VoiceSettings>): Promise<void> {
  const current = await getVoiceSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ voiceSettings: updated });
}

/**
 * Fetch available voices from ElevenLabs API
 */
export async function fetchAvailableVoices(apiKey: string): Promise<Voice[]> {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    const data = await response.json();
    return data.voices || [];
  } catch (error) {
    console.error('[Voice Settings] Error fetching voices:', error);
    return [];
  }
}

/**
 * Get popular/recommended voices for quick selection
 */
export function getRecommendedVoices(): Array<{ id: string; name: string; description: string }> {
  return [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Friendly female voice' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Professional male voice' },
    { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'Warm female voice' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Casual male voice' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Clear female voice' }
  ];
}

/**
 * Filter voices by criteria
 */
export function filterVoices(voices: Voice[], criteria: {
  gender?: string;
  accent?: string;
  age?: string;
}): Voice[] {
  return voices.filter(voice => {
    if (criteria.gender && voice.labels.gender !== criteria.gender) return false;
    if (criteria.accent && voice.labels.accent !== criteria.accent) return false;
    if (criteria.age && voice.labels.age !== criteria.age) return false;
    return true;
  });
}
