let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return audioCtx;
}

/** Call this during a user gesture (tap/click) to unlock audio on iOS */
export function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    // Play a silent buffer to fully unlock iOS audio
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
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
  try {
    const ctx = getAudioCtx();
    // Resume context (required on iOS after user interaction)
    if (ctx.state === 'suspended') await ctx.resume();
    // Three loud beeps at 880Hz — audible through AirPods and speakers
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'square'; // square wave is louder/more noticeable than sine
      const vol = 0.8; // loud enough for AirPods
      const start = ctx.currentTime + i * 0.25;
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.15);
      osc.start(start);
      osc.stop(start + 0.15);
    }
  } catch {}
}
