'use client';

import { useEffect } from 'react';

// Starts the glucose Live Activity when running inside the native app. It's a
// no-op in the browser/PWA (the Capacitor bridge + LiveActivity plugin only
// exist in the native build), so this is safe to ship to the web. No dependency
// import — we use the runtime-injected `window.Capacitor` bridge.
type CapBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: { LiveActivity?: { start?: () => Promise<unknown> } };
};

export default function LiveActivityStarter() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: CapBridge }).Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.LiveActivity?.start) {
      cap.Plugins.LiveActivity.start().catch(() => {});
    }
  }, []);
  return null;
}
