'use client';

// Adapted from tag.observe.tw web/src/components/SiteAnalytics.tsx, MIT, Copyright (c) 2026 Sky Hong.
import { useEffect } from 'react';
import { analyticsBlock, CLEAR_LOGIN_COMPLETED, measurementId, readOptOut } from '@/lib/analytics-consent.mts';
import { installAnalytics } from '@/lib/analytics-runtime.mts';

const GA_ID = measurementId(process.env.NEXT_PUBLIC_GA_ID);

// Decides after hydration, before any Google script exists, whether this page
// load may measure at all (analyticsBlock); blocked browsers get no script and
// no requests. Page views, navigation guards and events: lib/analytics-runtime.mts.
export default function SiteAnalytics() {
  useEffect(() => {
    let optedOut: boolean | null = null;
    try {
      optedOut = readOptOut(window.localStorage);
    } catch {}
    const block = analyticsBlock({
      production: process.env.NODE_ENV === 'production',
      hostname: location.hostname,
      measurementId: GA_ID,
      webdriver: navigator.webdriver,
      doNotTrack: navigator.doNotTrack,
      globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl,
      userAgent: navigator.userAgent,
      optedOut,
    });
    const win = window as unknown as Window & Record<string, unknown>;
    // GA's documented kill switch, in case a tag was loaded some other way.
    if (GA_ID) win[`ga-disable-${GA_ID}`] = true;
    if (block || !GA_ID) return;
    return installAnalytics({
      id: GA_ID,
      origin: location.origin,
      href: () => location.href,
      referrer: document.referrer,
      history: window.history,
      win,
      doc: document,
      localStorage: () => window.localStorage,
      cookie: () => document.cookie,
      clearLoginReceipt: () => {
        // biome-ignore lint/suspicious/noDocumentCookie: deleting the gateway's boolean login marker.
        document.cookie = CLEAR_LOGIN_COMPLETED;
      },
      loadScript: (src, onload) => {
        if (document.querySelector(`script[src="${src}"]`)) return;
        const script = document.createElement('script');
        script.async = true;
        script.src = src;
        script.addEventListener('load', onload, { once: true });
        document.head.appendChild(script);
      },
      noindex: () => /\bnoindex\b/i.test(document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? ''),
    });
  }, []);
  return null;
}
