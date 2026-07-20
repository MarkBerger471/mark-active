'use client';

import { useEffect } from 'react';

/**
 * iOS auto-zooms in when you focus an input whose font is < 16px — helpful for
 * seeing what you type. But in the native WKWebView it often does NOT zoom back
 * out when the field blurs, leaving you stuck zoomed in (force-restart to fix).
 *
 * On blur we momentarily clamp `maximum-scale` to 1 (which forces iOS to snap
 * the page back to 1×), then restore pinch-zoom a moment later. Net effect:
 * focus still zooms in to read the field, and finishing the field returns you
 * to normal — while manual pinch-zoom stays available.
 */
export default function ViewportZoomReset() {
  useEffect(() => {
    const vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!vp) return;
    const base = 'width=device-width, initial-scale=1, viewport-fit=cover';
    const zoomable = `${base}, minimum-scale=1, maximum-scale=5, user-scalable=yes`;
    const locked = `${base}, minimum-scale=1, maximum-scale=1, user-scalable=no`;
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

    let t: ReturnType<typeof setTimeout>;
    const onFocusOut = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      vp.setAttribute('content', locked);        // snap back to 1×
      clearTimeout(t);
      t = setTimeout(() => vp.setAttribute('content', zoomable), 350); // re-allow pinch
    };

    document.addEventListener('focusout', onFocusOut);
    return () => { document.removeEventListener('focusout', onFocusOut); clearTimeout(t); };
  }, []);

  return null;
}
