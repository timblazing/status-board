import { useEffect, useState } from 'react';

/** Formats an epoch-ms timestamp as `1s` / `45s` / `3m` / `2h`. */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * A single 1s tick drives every relative label on the page, rather than one
 * timer per row. Idles while the tab is hidden.
 */
export function useRelativeTime(since: number): string {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!since) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer = setInterval(() => tick((n) => n + 1), 1000);
    };
    const onVisibility = () => {
      clearInterval(timer);
      if (!document.hidden) {
        tick((n) => n + 1);
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [since]);

  return since ? formatAgo(Date.now() - since) : '—';
}
