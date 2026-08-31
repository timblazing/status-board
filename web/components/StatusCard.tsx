import { m } from 'motion/react';
import type { StatusSnapshot } from '@shared/types.ts';
import { ServiceRow } from './ServiceRow.tsx';
import { useResolvedTheme } from '../lib/useResolvedTheme.ts';

interface Props {
  data: StatusSnapshot;
  stale: boolean;
  /** True only for the first render, to gate the row stagger. */
  firstPaint: boolean;
}

export function StatusCard({ data, stale, firstPaint }: Props) {
  const dark = useResolvedTheme(data.theme);
  const rows = data.groups
    ? data.groups.flatMap((g) => g.services)
    : data.services;

  let index = -1;

  return (
    <m.main
      // No horizontal padding on the card: the header rule is the one divider
      // that spans it edge to edge, so header and rows pad themselves instead.
      className="w-full max-w-[540px] overflow-hidden rounded-[20px] border pt-[16px] pb-[6px]"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--card-border)',
        boxShadow: 'var(--shadow)',
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <header
        className="flex flex-wrap items-center gap-x-[10px] gap-y-2 border-b px-[18px] pb-[13px]"
        style={{ borderColor: 'var(--rule)' }}
      >
        <h1 className="text-[17px] leading-none font-semibold tracking-tight">{data.title}</h1>
        <span
          className="ml-auto font-mono text-[11px] leading-none tabular-nums"
          style={{ color: stale ? 'var(--bad)' : 'var(--muted)' }}
        >
          {stale ? 'Reconnecting…' : `${data.healthy}/${data.total} healthy`}
        </span>
      </header>

      <div className="sb-panel">
        {data.groups ? (
          data.groups.map((group) => (
            <section key={group.name}>
              <h2
                className="mx-[18px] border-b pt-[13px] pb-[9px] font-mono text-[10px] tracking-[0.08em] uppercase"
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
                    dark={dark}
                    icons={data.iconsEnabled}
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
                dark={dark}
                icons={data.iconsEnabled}
              />
            ))}
          </ul>
        )}
      </div>
    </m.main>
  );
}
