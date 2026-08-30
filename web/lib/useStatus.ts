import { useEffect, useRef, useState } from 'react';
import type { StatusSnapshot } from '@shared/types.ts';

interface State {
  data: StatusSnapshot | null;
  error: boolean;
  /** Epoch ms of the last successful fetch, for the "Updated Ns ago" label. */
  fetchedAt: number;
}

/**
 * Polls /api/status on the interval the server reports. Polling stops while
 * the tab is hidden and resumes with an immediate fetch, so a backgrounded
 * board costs nothing.
 */
export function useStatus(): State {
  const [state, setState] = useState<State>({ data: null, error: false, fetchedAt: 0 });
  // Held in a ref so changing the interval doesn't tear down the effect.
  const intervalRef = useRef(5);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let cancelled = false;

    const schedule = () => {
      timer = setTimeout(run, intervalRef.current * 1000);
    };

    const run = async () => {
      if (cancelled || document.hidden) return;
      controller = new AbortController();
      try {
        const res = await fetch('/api/status', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as StatusSnapshot;
        if (cancelled) return;
        intervalRef.current = data.refreshInterval;
        setState({ data, error: false, fetchedAt: Date.now() });
      } catch {
        // Keep showing the last good snapshot; just flag the connection.
        if (!cancelled) setState((s) => ({ ...s, error: true }));
      } finally {
        if (!cancelled) schedule();
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        controller?.abort();
      } else {
        void run();
      }
    };

    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return state;
}
