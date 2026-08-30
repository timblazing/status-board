import { m } from 'motion/react';
import type { ServiceState } from '@shared/types.ts';

const TOKENS: Record<ServiceState, { bg: string; fg: string }> = {
  operational: { bg: 'var(--ok-pill-bg)', fg: 'var(--ok-pill-fg)' },
  degraded: { bg: 'var(--warn-pill-bg)', fg: 'var(--warn-pill-fg)' },
  down: { bg: 'var(--bad-pill-bg)', fg: 'var(--bad-pill-fg)' },
  pending: { bg: 'var(--empty)', fg: 'var(--muted)' },
};

interface Props {
  state: ServiceState;
  label: string;
  /** Row badges sit beside the service name, so they run a size smaller. */
  small?: boolean;
}

export function StatusPill({ state, label, small = false }: Props) {
  const t = TOKENS[state];
  return (
    <m.span
      className={
        'inline-flex shrink-0 items-center rounded-full leading-none font-medium tabular-nums whitespace-nowrap ' +
        (small ? 'px-[7px] py-[2px] text-[10px]' : 'px-[9px] py-[3px] text-[11px]')
      }
      // Colour is the only thing that moves when a service flips state.
      animate={{ backgroundColor: t.bg, color: t.fg }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {label}
    </m.span>
  );
}
