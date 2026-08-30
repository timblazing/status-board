import { useEffect } from 'react';
import type { StatusSnapshot } from '@shared/types.ts';

/**
 * The lucide `activity` glyph, drawn at green-500. Inlined as a data URI so
 * the icon costs no request and no build step, and so the same markup can be
 * restored when a configured `favicon` is later removed.
 */
const ACTIVITY_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>' +
      '</svg>',
  );

function setFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/**
 * Keeps the tab title, colour theme and favicon in step with the served
 * config. Reapplied whenever `configVersion` changes, so an edit to
 * config.yaml lands on open tabs on their next poll — no refresh, no restart.
 */
export function useDocumentChrome(data: StatusSnapshot | null): void {
  const version = data?.configVersion;

  useEffect(() => {
    if (!data) return;
    document.title = data.title;
  }, [data?.title, version]);

  useEffect(() => {
    if (!data) return;
    setFavicon(data.favicon ?? ACTIVITY_ICON);
  }, [data?.favicon, version]);

  useEffect(() => {
    if (!data) return;
    const el = document.documentElement;
    el.dataset.theme = data.theme;

    if (data.theme !== 'system') {
      delete el.dataset.resolved;
      return;
    }
    // `system` is the only theme that has to track the OS, so the listener
    // exists only while it is selected.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      el.dataset.resolved = mq.matches ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [data?.theme, version]);
}
