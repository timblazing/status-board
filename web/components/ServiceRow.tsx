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
  const { name, state, description, uptimePct, history, windowSeconds } = service;
  // The badge carries uptime, so it needs a legible placeholder before the
  // first check lands.
  const badge = uptimePct == null ? '—' : `${uptimePct.toFixed(2)}%`;

  return (
    <m.li
      className="flex flex-col gap-[10px] border-b border-dashed px-[18px] py-[13px] sm:grid sm:grid-cols-[minmax(0,1fr)_auto_72px] sm:items-center sm:gap-x-4"
      style={{ borderColor: 'var(--rule)' }}
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Line 1 on mobile: name + badge. On desktop the badge moves to the right. */}
      <div className="flex min-w-0 items-start justify-between gap-3 sm:block">
        <div className="min-w-0">
          <div className="truncate text-[15px] leading-tight font-medium">{name}</div>
          {show.description && (
            <div
              className="mt-[3px] truncate font-mono text-[11px] leading-none"
              style={{ color: 'var(--muted)' }}
              title={description}
            >
              {description}
            </div>
          )}
        </div>
        <span className="sm:hidden">
          <StatusPill state={state} label={badge} />
        </span>
      </div>

      {show.bars && (
        <div className="min-w-0 sm:justify-self-end">
          <HistoryBars history={history} windowSeconds={windowSeconds} />
        </div>
      )}

      <span className="hidden sm:inline-flex sm:justify-self-end">
        <StatusPill state={state} label={badge} />
      </span>
    </m.li>
  );
});
