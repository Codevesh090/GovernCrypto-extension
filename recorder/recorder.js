/**
 * recorder.js — runs in a small popup window (normal browser context).
 * getUserMedia works here and Chrome shows its native mic permission prompt.
 *
 * Flow:
 *  1. Immediately calls getUserMedia — Chrome shows mic popup if needed
 *  2. Records with silence detection (5s default)
 *  3. Sends base64 audio back to opener via postMessage
 *  4. Closes itself
 */

const statusEl = document.getElementById('status');
const dotEl    = document.getElementById('dot');

function setStatus(msg, recording) {
  statusEl.textContent = msg;
  dotEl.className = recording ? 'dot show' : 'dot';
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}

async function run() {
  // --- Step 1: Get mic access (triggers Chrome's native permission popup) ---
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Microphone access denied.\nPlease click Allow when Chrome asks.'
      : err.name === 'NotFoundError'
      ? 'No microphone found.'
      : `Mic error: ${err.message}`;
    setStatus(msg, false);
    // Send error back to opener
    if (window.opener) {
      window.opener.postMessage({ type: 'RECORDER_ERROR', error: err.name === 'NotAllowedError' ? 'MIC_DENIED' : msg }, '*');
    }
    setTimeout(() => window.close(), 2500);
    return;
  }

  // --- Step 2: Record ---
  setStatus('🔴 Listening... speak now', true);

  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks   = [];

  // Silence detection
  const ctx      = new AudioContext();
  const source   = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);

  // Read silenceMs from URL param (default 5000)
  const params    = new URLSearchParams(window.location.search);
  const silenceMs = parseInt(params.get('silenceMs') || '5000', 10);

  let silenceTimer = null;
  let hasAudio     = false;

  function tick() {
    analyser.getByteFrequencyData(buf);
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
    if (avg > 5) {
      hasAudio = true;
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    } else if (hasAudio && !silenceTimer) {
      silenceTimer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, silenceMs);
    }
    if (recorder.state === 'recording') requestAnimationFrame(tick);
  }

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
    if (silenceTimer) clearTimeout(silenceTimer);
    setStatus('Processing...', false);

    const blob   = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      if (window.opener) {
        window.opener.postMessage({
          type:     'RECORDER_DONE',
          audio:    base64,
          mimeType: mimeType || 'audio/webm'
        }, '*');
      }
      window.close();
    };
    reader.readAsDataURL(blob);
  };

  recorder.onerror = () => {
    stream.getTracks().forEach(t => t.stop());
    if (window.opener) window.opener.postMessage({ type: 'RECORDER_ERROR', error: 'Recording failed.' }, '*');
    window.close();
  };

  recorder.start(100);
  requestAnimationFrame(tick);
}

run();
