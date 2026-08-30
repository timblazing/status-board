import { m } from 'motion/react';
import type { ServiceState, StatusSnapshot } from '@shared/types.ts';
import { ServiceRow } from './ServiceRow.tsx';
import { StatusPill } from './StatusPill.tsx';

const OVERALL_LABEL: Record<ServiceState, string> = {
  operational: 'All systems operational',
  degraded: 'Partial degradation',
  down: 'Major outage',
  pending: 'Checking services',
};

interface Props {
  data: StatusSnapshot;
  stale: boolean;
  /** True only for the first render, to gate the row stagger. */
  firstPaint: boolean;
}

export function StatusCard({ data, stale, firstPaint }: Props) {
  const rows = data.groups
    ? data.groups.flatMap((g) => g.services)
    : data.services;

  let index = -1;

  return (
    <m.main
      className="w-full max-w-[540px] rounded-[20px] border p-[10px] pt-[18px]"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--card-border)',
        boxShadow: 'var(--shadow)',
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <header className="flex flex-wrap items-center gap-x-[10px] gap-y-2 px-2 pb-[14px]">
        <h1 className="text-[17px] leading-none font-semibold tracking-tight">{data.title}</h1>
        <StatusPill state={data.overall} label={OVERALL_LABEL[data.overall]} dot />
        <span
          className="ml-auto font-mono text-[11px] leading-none tabular-nums"
          style={{ color: stale ? 'var(--bad)' : 'var(--muted)' }}
        >
          {stale ? 'Reconnecting…' : `${data.healthy}/${data.total} healthy`}
        </span>
      </header>

      <div
        className="sb-panel overflow-hidden rounded-[14px] border"
        style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}
      >
        {data.groups ? (
          data.groups.map((group) => (
            <section key={group.name}>
              <h2
                className="border-b border-dashed px-[18px] pt-[13px] pb-[9px] font-mono text-[10px] tracking-[0.08em] uppercase"
                style={{ color: 'var(--muted)', borderColor: 'var(--rule)' }}
              >
                {group.name}
              </h2>
              <ul>
                {group.services.map((s) => (
                  <ServiceRow
                    key={s.name}
                    service={s}
                    show={data.show}
                    index={++index}
                    animate={firstPaint}
                  />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <ul>
            {rows.map((s) => (
              <ServiceRow
                key={s.name}
                service={s}
                show={data.show}
                index={++index}
                animate={firstPaint}
              />
            ))}
          </ul>
        )}
      </div>
    </m.main>
  );
}
