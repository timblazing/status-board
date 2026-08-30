import { memo } from 'react';
import { m } from 'motion/react';
import type { ServiceStatus, StatusSnapshot } from '@shared/types.ts';
import { HistoryBars } from './HistoryBars.tsx';
import { StatusPill } from './StatusPill.tsx';

const LABEL: Record<ServiceStatus['state'], string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  pending: 'Checking',
};

interface Props {
  service: ServiceStatus;
  show: StatusSnapshot['show'];
  /** First-paint stagger index; refreshes re-render without animating. */
  index: number;
  animate: boolean;
}

export const ServiceRow = memo(function ServiceRow({ service, show, index, animate }: Props) {
  const { name, state, latencyMs, uptimePct, history } = service;

  return (
    <m.li
      className="flex flex-col gap-[10px] border-b border-dashed px-[18px] py-[13px] sm:grid sm:grid-cols-[minmax(0,1fr)_auto_44px_92px] sm:items-center sm:gap-x-3"
      style={{ borderColor: 'var(--rule)' }}
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Line 1 on mobile: name + pill. On desktop the pill moves to the far right. */}
      <div className="flex min-w-0 items-start justify-between gap-3 sm:block">
        <div className="min-w-0">
          <div className="truncate text-[15px] leading-tight font-medium">{name}</div>
          {show.uptime && (
            <div
              className="mt-[3px] font-mono text-[11px] leading-none"
              style={{ color: 'var(--muted)' }}
            >
              uptime · {uptimePct == null ? '—' : `${uptimePct.toFixed(2)}%`}
            </div>
          )}
        </div>
        <span className="sm:hidden">
          <StatusPill state={state} label={LABEL[state]} />
        </span>
      </div>

      {/* Line 2 on mobile: bars + latency share a row. */}
      <div className="flex items-end justify-between gap-3 sm:contents">
        {show.bars && (
          <div className="min-w-0 sm:justify-self-end">
            <HistoryBars history={history} />
          </div>
        )}
        {show.latency && (
          <div
            className="shrink-0 font-mono text-[11px] tabular-nums sm:text-right"
            style={{ color: 'var(--muted)' }}
          >
            {latencyMs == null ? '—' : `${latencyMs}ms`}
          </div>
        )}
      </div>

      <span className="hidden sm:inline-flex sm:justify-self-start">
        <StatusPill state={state} label={LABEL[state]} />
      </span>
    </m.li>
  );
});
