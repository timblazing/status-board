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
}

export function StatusPill({ state, label }: Props) {
  const { bg, fg, dot } = TOKENS[state];
  return (
    <m.span
      className="inline-flex shrink-0 items-center gap-[5px] rounded-full py-[3px] pr-[9px] pl-[7px] text-[11px] leading-none font-medium whitespace-nowrap"
      // Colour is the only thing that moves when a service flips state.
      animate={{ backgroundColor: bg, color: fg }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ backgroundColor: bg, color: fg }}
    >
      <m.span
        className="size-[5px] rounded-full"
        animate={{ backgroundColor: dot }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        style={{ backgroundColor: dot }}
      />
      {label}
    </m.span>
  );
}
