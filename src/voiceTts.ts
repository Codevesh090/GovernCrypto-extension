/**
 * Feature 4: Voice AI — Text-to-Speech (streaming) via ElevenLabs
 * Enhanced with multilingual support and capability detection
 */

import { getCapabilities } from './elevenLabsCapabilities.js';
import { getVoiceSettings } from './voiceSettings.js';

const TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

// Rachel — high-quality, natural, free default voice
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

let currentAudio: HTMLAudioElement | null = null;

/**
 * Stops any currently playing TTS audio.
 */
export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}

/**
 * Get the best voice for a given language
 * Returns a voice ID that has the right accent for the language
 * Updated to use native expert voices for each language
 * 
 * IMPORTANT: User's voice selection only affects English.
 * Other languages always use native accent voices.
 */
function getVoiceForLanguage(language: string, selectedVoiceId: string): string {
  // Language to voice mapping (native expert voices with authentic accents)
  const languageVoiceMap: Record<string, string> = {
    'hi': 'nPczCjzI2devNBz1zQrb', // Hindi voice (Brian - multilingual, excellent Hindi)
    'es': 'EXAVITQu4vr4xnSDxMaL', // Spanish voice (Sarah - native Spanish speaker)
    'fr': 'ThT5KcBeYPX3keUQqHPh', // French voice (Dorothy - native French speaker)
    'de': 'pNInz6obpgDQGcFmaJgB', // German voice (Adam - native German speaker)
    'pt': 'XB0fDUnXU5powFXDhCwa', // Portuguese voice (Charlotte - native Portuguese)
    'zh': 'onwK4e9ZLuTAKqWW03F9', // Chinese voice (Daniel - native Mandarin)
    'ja': 'IKne3meq5aSn9XLyUdCD', // Japanese voice (Charlie - native Japanese)
    'ko': 'bIHbv24MWmeRgasZH58o', // Korean voice (Clyde - native Korean)
    'ru': 'nPczCjzI2devNBz1zQrb', // Russian voice (Brian - native Russian)
    'it': 'XrExE9yKIg1WjnnlVkGX', // Italian voice (Matilda - native Italian)
    'nl': 'flq6f7yk4E4fJM5XTYuZ', // Dutch voice (Michael - native Dutch)
    'tr': 'yoZ06aMxZJJ28mfd3POQ', // Turkish voice (Sam - native Turkish)
    'vi': 'AZnzlk1XvdvUeBnXmlld', // Vietnamese voice (Domi - native Vietnamese)
    'ar': 'pqHfZKP75CvOlQylNhV4', // Arabic voice (Bill - native Arabic)
  };
  
  // For non-English languages, ALWAYS use the native voice (ignore user's selection)
  if (language && language !== 'en' && languageVoiceMap[language]) {
    console.log(`[TTS] Using native ${language} voice (user selection ignored for non-English):`, languageVoiceMap[language]);
    return languageVoiceMap[language];
  }
  
  // For English, use the user's selected voice
  console.log(`[TTS] Using user-selected voice for English:`, selectedVoiceId);
  return selectedVoiceId;
}

/**
 * Streams TTS audio from ElevenLabs and plays it progressively.
 * Uses eleven_turbo_v2 for lowest latency (Creator plan).
 * Falls back to eleven_monolingual_v1 for free tier.
 */
export async function speakTextStream(
  text: string,
  apiKey: string,
  voiceId?: string,
  language?: string,
  onAudioReady?: () => void
): Promise<void> {
  stopSpeaking(); // interrupt any previous playback

  // Get capabilities and settings
  const capabilities = await getCapabilities();
  const settings = await getVoiceSettings();
  
  // Use provided voice or user's saved preference or default
  const selectedVoiceId = voiceId || settings.selectedVoiceId || DEFAULT_VOICE_ID;
  
  // Get the best voice for the language (with native accent)
  const finalVoiceId = getVoiceForLanguage(language || 'en', selectedVoiceId);
  
  // Determine model based on capabilities and language
  const model = getModelForCapabilities(capabilities, language);
  
  // Use streaming if available, otherwise use standard endpoint
  const endpoint = capabilities.hasStreaming 
    ? `${TTS_BASE}/${finalVoiceId}/stream`
    : `${TTS_BASE}/${finalVoiceId}`;

  console.log(`[TTS] Using model: ${model}, voice: ${finalVoiceId}, streaming: ${capabilities.hasStreaming}, language: ${language || 'en'}`);
  console.log(`[TTS] Speech speed: ${settings.speechSpeed}x`);
  console.log(`[TTS] Text to speak (first 200 chars): "${text.substring(0, 200)}..."`);
  console.log(`[TTS] Text length: ${text.length} characters`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.7,
        style: 0.0,
        use_speaker_boost: true
      }
    })
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('[TTS] Error response:', res.status, err);
    
    // Provide helpful error messages
    if (res.status === 401) {
      throw new Error('API key invalid. Please check your ElevenLabs API key.');
    } else if (res.status === 403) {
      throw new Error('This feature is not enabled for your API key. Please enable "Text to Speech: Access" in your ElevenLabs API key settings.');
    } else if (res.status === 422 && err.includes('model')) {
      // Model not available - try fallback
      console.warn('[TTS] Model not available, trying basic model...');
      throw new Error('The selected voice model is not available with your API key. Please enable multilingual or streaming features in your API key settings.');
    }
    
    throw new Error(`TTS error ${res.status}: ${err}`);
  }

  // Collect all chunks then play — avoids MediaSource API (not available in extensions)
  console.log('[TTS] Starting to collect audio chunks...');
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  console.log('[TTS] Collected', chunks.length, 'audio chunks');
  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  console.log('[TTS] Created audio blob, size:', blob.size, 'bytes');

  const audio = new Audio(url);
  currentAudio = audio;
  
  // Apply speech speed if not default
  if (settings.speechSpeed !== 1.0) {
    audio.playbackRate = settings.speechSpeed;
  }

  // CRITICAL: Try to route audio to Bluetooth/system default output device
  // Chrome extensions have limitations with audio routing, so we try multiple approaches
  let audioDeviceSet = false;
  try {
    if ('setSinkId' in audio) {
      // First, try to enumerate audio output devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
      
      console.log('[TTS] Available audio outputs:', audioOutputs.map(d => ({
        deviceId: d.deviceId,
        label: d.label,
        groupId: d.groupId
      })));
      
      // Try to find Bluetooth device (look for common Bluetooth keywords)
      const bluetoothDevice = audioOutputs.find(d => 
        d.label.toLowerCase().includes('bluetooth') ||
        d.label.toLowerCase().includes('airpods') ||
        d.label.toLowerCase().includes('headphones') ||
        d.label.toLowerCase().includes('headset')
      );
      
      if (bluetoothDevice && bluetoothDevice.deviceId) {
        // Use the Bluetooth device
        await (audio as any).setSinkId(bluetoothDevice.deviceId);
        console.log('[TTS] Audio routed to Bluetooth device:', bluetoothDevice.label);
        audioDeviceSet = true;
      } else {
        // Use default device (first in list or 'default')
        const defaultDevice = audioOutputs.find(d => d.deviceId === 'default') || audioOutputs[0];
        if (defaultDevice) {
          await (audio as any).setSinkId(defaultDevice.deviceId);
          console.log('[TTS] Audio routed to default device:', defaultDevice.label);
          audioDeviceSet = true;
        } else {
          console.warn('[TTS] No audio output devices found, using browser default');
        }
      }
    } else {
      console.warn('[TTS] setSinkId not supported in this browser');
    }
  } catch (err) {
    console.error('[TTS] Could not set audio output device:', err);
    // Continue anyway - audio will play through browser's default
  }

  console.log('[TTS] Audio object created, calling onAudioReady callback...');
  
  // Call the callback when audio is ready to play (before actually playing)
  if (onAudioReady) {
    onAudioReady();
  }

  console.log('[TTS] Starting audio playback...');
  
  // Add a retry mechanism for audio playback
  let playAttempts = 0;
  const maxAttempts = 3;
  
  const attemptPlay = async (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      playAttempts++;
      console.log(`[TTS] Play attempt ${playAttempts}/${maxAttempts}`);
      
      audio.onended = () => {
        console.log('[TTS] Audio playback ended');
        URL.revokeObjectURL(url);
        currentAudio = null;
        resolve();
      };
      
      audio.onerror = async (e) => {
        console.error('[TTS] Audio playback error:', e);
        console.error('[TTS] Audio error details:', {
          error: audio.error,
          errorCode: audio.error?.code,
          errorMessage: audio.error?.message,
          networkState: audio.networkState,
          readyState: audio.readyState,
          src: audio.src
        });
        
        // If we haven't exceeded max attempts and device was set, try without device routing
        if (playAttempts < maxAttempts && audioDeviceSet) {
          console.warn('[TTS] Retrying without device routing...');
          try {
            // Reset to default device
            if ('setSinkId' in audio) {
              await (audio as any).setSinkId('');
            }
            // Try playing again
            await attemptPlay();
            resolve();
          } catch (retryErr) {
            URL.revokeObjectURL(url);
            currentAudio = null;
            reject(new Error('Audio playback failed after retries - please check your audio device settings'));
          }
        } else {
          URL.revokeObjectURL(url);
          currentAudio = null;
          reject(new Error('Audio playback error - the audio file may be corrupted or the voice may not support this language'));
        }
      };
      
      audio.play().then(() => {
        console.log('[TTS] Audio play() started successfully');
      }).catch((playErr) => {
        console.error('[TTS] Audio play() failed:', playErr);
        URL.revokeObjectURL(url);
        currentAudio = null;
        reject(new Error(`Audio play failed: ${playErr.message}`));
      });
    });
  };
  
  await attemptPlay();
}

/**
 * Determine the best model based on capabilities and language
 */
function getModelForCapabilities(capabilities: any, language?: string): string {
  console.log('[TTS] Model selection - Language:', language, 'Has multilingual:', capabilities.hasMultilingual, 'Has streaming:', capabilities.hasStreaming);
  
  // If multilingual is needed and available
  if (language && language !== 'en' && capabilities.hasMultilingual) {
    const model = capabilities.hasStreaming ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2';
    console.log('[TTS] Using multilingual model:', model);
    return model;
  }
  
  // If streaming is available (Creator+ tier)
  if (capabilities.hasStreaming) {
    console.log('[TTS] Using streaming model: eleven_turbo_v2');
    return 'eleven_turbo_v2';
  }
  
  // Free tier - use basic model
  console.log('[TTS] Using basic model: eleven_monolingual_v1');
  return 'eleven_monolingual_v1';
}

