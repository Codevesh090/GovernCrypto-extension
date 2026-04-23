/**
 * Feature 4: Voice AI — Text-to-Speech (streaming) via ElevenLabs
 */

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
 * Streams TTS audio from ElevenLabs and plays it progressively.
 * Uses eleven_turbo_v2 for lowest latency (Creator plan).
 */
export async function speakTextStream(
  text: string,
  apiKey: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<void> {
  stopSpeaking(); // interrupt any previous playback

  const res = await fetch(`${TTS_BASE}/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.7
      }
    })
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`TTS error ${res.status}: ${err}`);
  }

  // Collect all chunks then play — avoids MediaSource API (not available in extensions)
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  const audio = new Audio(url);
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      reject(new Error('Audio playback error'));
    };
    audio.play().catch(reject);
  });
}
