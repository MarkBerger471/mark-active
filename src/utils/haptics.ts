export function hapticLight() {
  try { navigator?.vibrate?.(10); } catch {}
}

export function hapticMedium() {
  try { navigator?.vibrate?.(25); } catch {}
}

export function hapticSuccess() {
  try { navigator?.vibrate?.([10, 50, 20]); } catch {}
}
