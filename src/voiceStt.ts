/**
 * Feature 4: Voice AI — Speech Recognition via Web Speech API
 *
 * Uses the browser's built-in SpeechRecognition which:
 * - Works directly in the side panel (no popup window needed)
 * - Shows Chrome's native mic permission prompt inline on first use
 * - Provides real-time interim transcripts as the user speaks
 * - Stops automatically on silence
 */

export interface SpeechResult {
  transcript: string;
}

type TranscriptCallback = (interim: string, isFinal: boolean) => void;

/**
 * Records speech using Web Speech API.
 * Calls onTranscript in real-time with interim results.
 * Resolves with the final transcript when the user stops speaking.
 */
export function recordWithSpeechAPI(
  onTranscript: TranscriptCallback,
  silenceMs = 2000
): { promise: Promise<string>; stop: () => void } {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return {
      promise: Promise.reject(new Error('Speech recognition not supported in this browser.')),
      stop: () => {}
    };
  }

  const recognition = new SpeechRecognition();
  recognition.continuous     = true;   // keep listening until we stop it
  recognition.interimResults = true;   // fire events as user speaks
  recognition.lang           = 'en-US';
  recognition.maxAlternatives = 1;

  let finalTranscript  = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let resolved         = false;

  const promise = new Promise<string>((resolve, reject) => {
    recognition.onresult = (event: any) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }

      // Show real-time transcript
      onTranscript((finalTranscript + interim).trim(), false);

      // Reset silence timer on every speech event
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
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
        reject(new Error('No speech detected. Please try again.'));
      }
    };

    recognition.onerror = (event: any) => {
      if (resolved) return;
      resolved = true;
      if (silenceTimer) clearTimeout(silenceTimer);
      const msg =
        event.error === 'not-allowed'  ? 'Microphone access denied. Click Allow when Chrome asks.' :
        event.error === 'no-speech'    ? 'No speech detected. Please try again.' :
        event.error === 'network'      ? 'Network error during speech recognition.' :
        `Speech error: ${event.error}`;
      reject(new Error(msg));
    };

    try {
      recognition.start();
    } catch (err: any) {
      resolved = true;
      reject(new Error(`Could not start microphone: ${err.message}`));
    }
  });

  const stop = () => {
    if (!resolved) {
      try { recognition.stop(); } catch {}
    }
  };

  return { promise, stop };
}
