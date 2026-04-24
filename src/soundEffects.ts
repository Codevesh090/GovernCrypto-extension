/**
 * Enhanced Sound Effects System
 * Professional audio feedback for UI interactions
 */

export type SoundEffect = 
  | 'success' 
  | 'error' 
  | 'warning' 
  | 'notification'
  | 'click'
  | 'open'
  | 'close'
  | 'vote-cast'
  | 'deadline-warning'
  | 'mic-start'
  | 'mic-stop';

/**
 * Play a sound effect using Web Audio API
 */
export function playSoundEffect(effect: SoundEffect, volume: number = 0.3): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    
    switch (effect) {
      case 'success':
        // Cheerful ascending chime
        osc.frequency.setValueAtTime(523, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(784, ctx.currentTime + 0.16); // G5
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
        break;
        
      case 'error':
        // Low descending tone
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.setValueAtTime(300, ctx.currentTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
        break;
        
      case 'warning':
        // Double beep
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(volume, ctx.currentTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
        break;
        
      case 'notification':
        // Gentle ping
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
        break;
        
      case 'click':
        // Subtle click
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(volume * 0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.05);
        break;
        
      case 'open':
        // Rising two-tone
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
        break;
        
      case 'close':
        // Falling tone
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
        break;
        
      case 'vote-cast':
        // Triumphant three-note chord
        playChord(ctx, [523, 659, 784], volume, 0.5); // C-E-G major chord
        return; // Early return since playChord handles cleanup
        
      case 'deadline-warning':
        // Urgent pulsing tone
        osc.frequency.setValueAtTime(900, ctx.currentTime);
        for (let i = 0; i < 3; i++) {
          gain.gain.setValueAtTime(volume, ctx.currentTime + i * 0.2);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.1);
        }
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
        break;
        
      case 'mic-start':
        // Quick ascending beep
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.setValueAtTime(900, ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
        break;
        
      case 'mic-stop':
        // Quick descending beep
        osc.frequency.setValueAtTime(900, ctx.currentTime);
        osc.frequency.setValueAtTime(600, ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
        break;
    }
    
    osc.onended = () => ctx.close();
  } catch (error) {
    console.error('[Sound Effects] Error playing sound:', error);
  }
}

/**
 * Play a chord (multiple frequencies simultaneously)
 */
function playChord(ctx: AudioContext, frequencies: number[], volume: number, duration: number): void {
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);
  gainNode.gain.setValueAtTime(volume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  
  frequencies.forEach(freq => {
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  });
  
  setTimeout(() => ctx.close(), duration * 1000 + 100);
}

/**
 * Check if sound effects are enabled
 */
export async function areSoundEffectsEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get('voiceSettings');
  return result.voiceSettings?.soundEffectsEnabled !== false;
}

/**
 * Play sound effect if enabled
 */
export async function playIfEnabled(effect: SoundEffect, volume?: number): Promise<void> {
  const enabled = await areSoundEffectsEnabled();
  if (enabled) {
    playSoundEffect(effect, volume);
  }
}
