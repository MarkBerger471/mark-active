let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return audioCtx;
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

export function playTimerBeep() {
  try {
    const ctx = getAudioCtx();
    // Three short beeps
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.3;
      const start = ctx.currentTime + i * 0.2;
      osc.start(start);
      osc.stop(start + 0.1);
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.1);
    }
  } catch {}
}
