let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return audioCtx;
}

// Pre-created Audio element for iOS — must be created during user gesture
let beepAudio: HTMLAudioElement | null = null;

// Generate a beep WAV as base64 data URI (3 short beeps at 880Hz)
function generateBeepDataUri(): string {
  const sampleRate = 22050;
  const beepDuration = 0.12;
  const pauseDuration = 0.13;
  const numBeeps = 3;
  const totalSamples = Math.ceil(sampleRate * (beepDuration + pauseDuration) * numBeeps);
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  // Generate beeps
  const beepSamples = Math.floor(sampleRate * beepDuration);
  const cycleSamples = Math.floor(sampleRate * (beepDuration + pauseDuration));
  for (let i = 0; i < totalSamples; i++) {
    const beepIdx = i % cycleSamples;
    let sample = 0;
    if (beepIdx < beepSamples) {
      sample = Math.sin(2 * Math.PI * 880 * beepIdx / sampleRate) * 0.8 * 32767;
      // Fade out last 20%
      const fadePos = beepIdx / beepSamples;
      if (fadePos > 0.8) sample *= (1 - fadePos) / 0.2;
    }
    view.setInt16(44 + i * 2, sample, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

/** Call this during a user gesture (tap/click) to unlock audio on iOS */
export function unlockAudio() {
  try {
    // Create and prime the Audio element during user gesture
    if (!beepAudio) {
      beepAudio = new Audio(generateBeepDataUri());
      beepAudio.volume = 1.0;
    }
    // iOS requires load() + play() during gesture to unlock — truly silent
    beepAudio.load();
    beepAudio.volume = 0;
    beepAudio.muted = true;
    beepAudio.play().then(() => { beepAudio!.pause(); beepAudio!.currentTime = 0; beepAudio!.muted = false; }).catch(() => {});
  } catch {}
  // Also unlock Web Audio API as fallback
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

// iOS doesn't support Vibration API — use AudioContext pulse as workaround
function pulse(duration = 10) {
  try { navigator?.vibrate?.(duration); } catch {}
  // AudioContext haptic for iOS
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.01; // nearly silent
    osc.frequency.value = 1;
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  } catch {}
}

export function hapticLight() { pulse(10); }
export function hapticMedium() { pulse(25); }
export function hapticSuccess() { pulse(30); }

export async function playTimerBeep() {
  // Primary: HTML Audio element (most reliable on iOS PWA)
  if (beepAudio) {
    try {
      beepAudio.currentTime = 0;
      beepAudio.volume = 1.0;
      await beepAudio.play();
      return; // success
    } catch {}
  }
  // Fallback: Web Audio API oscillators
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'square';
      const vol = 0.8;
      const start = ctx.currentTime + i * 0.25;
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.15);
      osc.start(start);
      osc.stop(start + 0.15);
    }
  } catch {}
}
