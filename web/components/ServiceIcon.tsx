import { useEffect, useRef, useState } from 'react';
import type { ServiceStatus } from '@shared/types.ts';

/**
 * The icon beside a service name:
 *
 *   1. `service.icon` — an svgl brand logo, or the explicit config `icon:`.
 *   2. The site's own `/favicon.ico`, for anything svgl doesn't know: your
 *      own services, internal hosts, niche tools.
 *
 * A service with neither renders nothing at all, and its text simply starts at
 * the row's left edge — a placeholder tile would be more visual noise than the
 * icon itself is worth.
 *
 * Candidates are walked by letting the image fail: there is no way to ask
 * whether a cross-origin image exists without trying to load it. Loading is
 * driven imperatively through `new Image()` rather than an <img> with
 * onLoad/onError, because only that lets a candidate be abandoned on a timeout
 * — an unreachable host leaves a request hanging forever without ever firing
 * `error`, which would otherwise strand the row on an empty gap.
 */

/** Sized to span the service name and the description line beneath it. */
const SIZE = 32;

/** How long a candidate gets to load before it counts as a miss. */
const LOAD_TIMEOUT_MS = 6000;

interface Props {
  service: ServiceStatus;
  /** Resolved theme, so a light/dark logo pair picks the right variant. */
  dark: boolean;
}

export function ServiceIcon({ service, dark }: Props) {
  const { icon, url } = service;
  const logo = icon ? (dark ? icon.dark : icon.light) : null;
  const favicon = new URL('/favicon.ico', url).toString();

  /** The image that actually loaded, or null while we're still walking. */
  const [resolved, setResolved] = useState<string | null>(null);
  // Tracks the run that owns the current state, so a stale walk — from a
  // config reload, or a logo arriving mid-walk — can't overwrite a newer one.
  const runId = useRef(0);

  useEffect(() => {
    const run = ++runId.current;
    setResolved(null);

    // Ordered candidates: the brand logo when we have one, then the site's
    // own favicon. Falling off the end leaves `resolved` null — the monogram.
    const candidates = [logo, favicon].filter((c): c is string => c !== null);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tryAt = (i: number): void => {
      if (cancelled || i >= candidates.length) return;
      const src = candidates[i];
      const img = new Image();

      const next = () => {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        tryAt(i + 1);
      };

      img.onload = () => {
        clearTimeout(timer);
        // A decorative icon that loaded as a 0×0 is not worth showing.
        if (cancelled || run !== runId.current) return;
        if (img.naturalWidth > 0) setResolved(src);
        else next();
      };
      img.onerror = next;
      // The hang case: no error is ever coming, so move on ourselves.
      timer = setTimeout(next, LOAD_TIMEOUT_MS);
      img.src = src;
    };

    tryAt(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [logo, favicon]);

  if (!resolved) return null;

  return (
    <img
      src={resolved}
      alt=""
      aria-hidden
      width={SIZE}
      height={SIZE}
      className="shrink-0 rounded-[6px] object-contain"
      style={{ width: SIZE, height: SIZE }}
    />
  );
}
