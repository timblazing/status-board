import { memo } from 'react';
import { m } from 'motion/react';
import type { ServiceStatus, StatusSnapshot } from '@shared/types.ts';
import { HistoryBars } from './HistoryBars.tsx';
import { StatusPill } from './StatusPill.tsx';

interface Props {
  service: ServiceStatus;
  show: StatusSnapshot['show'];
  /** First-paint stagger index; refreshes re-render without animating. */
  index: number;
  animate: boolean;
}

export const ServiceRow = memo(function ServiceRow({ service, show, index, animate }: Props) {
  const { name, state, description, url, descriptionIsUrl, uptimePct, history, windowSeconds } =
    service;
  // The badge carries uptime, so it needs a legible placeholder before the
  // first check lands.
  const badge = uptimePct == null ? '—' : `${uptimePct.toFixed(2)}%`;

  return (
    <m.li
      // An even 1fr split rather than an auto name column: the bars then start
      // at the same x in every row and are all the same width, however long
      // the service name happens to be.
      className="sb-row flex flex-col gap-[10px] py-[13px] sm:grid sm:grid-cols-2 sm:items-center sm:gap-x-5"
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-[7px]">
          <span className="truncate text-[15px] leading-tight font-medium">{name}</span>
          <StatusPill state={state} label={badge} small />
        </div>
        {show.description &&
          (descriptionIsUrl ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-[3px] block truncate font-mono text-[11px] leading-none hover:underline"
              style={{ color: 'var(--muted)' }}
              title={url}
            >
              {description}
            </a>
          ) : (
            <div
              className="mt-[3px] truncate font-mono text-[11px] leading-none"
              style={{ color: 'var(--muted)' }}
              title={description}
            >
              {description}
            </div>
          ))}
      </div>

      {show.bars && (
        <div className="min-w-0">
          <HistoryBars
            history={history}
            windowSeconds={windowSeconds}
            labels={show.timeLabels}
          />
        </div>
      )}
    </m.li>
  );
});
