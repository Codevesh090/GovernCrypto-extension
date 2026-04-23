/**
 * offscreen.js — runs in a Chrome offscreen document.
 * getUserMedia works here. Records audio and sends result
 * back to background via chrome.runtime.sendMessage.
 */

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

async function startRecording(silenceMs) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    let msg;
    if (err.name === 'NotAllowedError') {
      msg = 'MIC_DENIED';
    } else if (err.name === 'NotFoundError') {
      msg = 'No microphone found. Please connect a microphone.';
    } else {
      msg = `Microphone error: ${err.message}`;
    }
    chrome.runtime.sendMessage({ type: 'RECORDER_ERROR', error: msg });
    return;
  }

  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];

  // Silence detection via AudioContext
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buffer = new Uint8Array(analyser.frequencyBinCount);

  let silenceTimer = null;
  let hasAudio = false;

  function checkSilence() {
    analyser.getByteFrequencyData(buffer);
    const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length;

    if (avg > 5) {
      hasAudio = true;
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    } else if (hasAudio && !silenceTimer) {
      silenceTimer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, silenceMs);
    }

    if (recorder.state === 'recording') requestAnimationFrame(checkSilence);
  }

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
    if (silenceTimer) clearTimeout(silenceTimer);

    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      chrome.runtime.sendMessage({
        type: 'RECORDER_DONE',
        audio: base64,
        mimeType: mimeType || 'audio/webm'
      });
    };
    reader.readAsDataURL(blob);
  };

  recorder.onerror = () => {
    stream.getTracks().forEach(t => t.stop());
    chrome.runtime.sendMessage({ type: 'RECORDER_ERROR', error: 'Recording failed.' });
  };

  recorder.start(100);
  requestAnimationFrame(checkSilence);
}

// Tell background we are ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });

// Listen for the actual record command
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DO_RECORD' && msg.target === 'offscreen') {
    startRecording(msg.silenceMs || 5000);
  }
});
