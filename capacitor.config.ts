import type { CapacitorConfig } from '@capacitor/cli';

// Private iOS build (Path A — TestFlight / personal signing, not the public
// App Store). The native shell loads the live Netlify app in a WKWebView;
// the existing service worker provides offline caching after first launch.
//
// Change `appId` to match the Bundle Identifier you register in your Apple
// Developer account before archiving.
const config: CapacitorConfig = {
  appId: 'com.markberger.markactive',
  appName: 'Mark Active',
  // Fallback web assets copied into the app bundle. We load the live URL
  // below, so this only needs to exist for the CLI — `public/` is fine.
  webDir: 'public',
  server: {
    // Load the deployed app. Comment this out (and bundle a static export
    // into webDir) later if you want a fully offline, locally-served build.
    url: 'https://mark-active.netlify.app',
    cleartext: false,
  },
  ios: {
    // 'never' = the web content goes edge-to-edge under the status bar, and
    // CSS env(safe-area-inset-*) is the single source of truth for insets.
    // 'always' double-insets (native inset + CSS env) and pushes the nav bar
    // too far down. Requires one Xcode re-run to take effect.
    contentInset: 'never',
    // Dark background behind the web content so there's no white flash.
    backgroundColor: '#0f0f1a',
  },
  backgroundColor: '#0f0f1a',
};

export default config;
