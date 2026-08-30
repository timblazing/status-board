import { m } from 'motion/react';
import type { ServiceState } from '@shared/types.ts';

const TOKENS: Record<ServiceState, { bg: string; fg: string; dot: string }> = {
  operational: { bg: 'var(--ok-pill-bg)', fg: 'var(--ok-pill-fg)', dot: 'var(--ok)' },
  degraded: { bg: 'var(--warn-pill-bg)', fg: 'var(--warn-pill-fg)', dot: 'var(--warn)' },
  down: { bg: 'var(--bad-pill-bg)', fg: 'var(--bad-pill-fg)', dot: 'var(--bad)' },
  pending: { bg: 'var(--empty)', fg: 'var(--muted)', dot: 'var(--muted)' },
};

interface Props {
  state: ServiceState;
  label: string;
  /** The header pill keeps its dot; row pills carry state by tint alone. */
  dot?: boolean;
  /** Row badges sit beside the service name, so they run a size smaller. */
  small?: boolean;
}

export function StatusPill({ state, label, dot = false, small = false }: Props) {
  const t = TOKENS[state];
  return (
    <m.span
      className={
        'inline-flex shrink-0 items-center rounded-full leading-none font-medium whitespace-nowrap ' +
        (small ? 'py-[2px] px-[7px] text-[10px] ' : 'py-[3px] text-[11px] ') +
        (dot ? 'gap-[5px] pr-[9px] pl-[7px]' : small ? 'tabular-nums' : 'px-[9px] tabular-nums')
      }
      // Colour is the only thing that moves when a service flips state.
      animate={{ backgroundColor: t.bg, color: t.fg }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {dot && (
        <m.span
          className="size-[5px] rounded-full"
          animate={{ backgroundColor: t.dot }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{ backgroundColor: t.dot }}
        />
      )}
      {label}
    </m.span>
  );
}
