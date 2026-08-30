import { m } from 'motion/react';
import type { ServiceState } from '@shared/types.ts';

/**
 * Service states mapped onto the shark badge variants: success, warning and
 * destructive. Each is that variant's recipe — a 10% tint of the colour, the
 * colour itself as text, and a 20% border of it — built with color-mix so a
 * single token per variant drives all three.
 */
const VARIANT: Record<ServiceState, string> = {
  operational: 'success',
  degraded: 'warning',
  down: 'destructive',
  pending: 'muted',
};

function tokens(state: ServiceState): { bg: string; fg: string; border: string } {
  const variant = VARIANT[state];
  if (variant === 'muted') {
    return { bg: 'var(--empty)', fg: 'var(--muted)', border: 'transparent' };
  }
  const base = `var(--${variant})`;
  return {
    bg: `color-mix(in oklab, ${base} 10%, transparent)`,
    fg: `var(--${variant}-fg)`,
    border: `color-mix(in oklab, ${base} 20%, transparent)`,
  };
}

interface Props {
  state: ServiceState;
  label: string;
  /** Row badges sit beside the service name, so they run a size smaller. */
  small?: boolean;
}

export function StatusPill({ state, label, small = false }: Props) {
  const t = tokens(state);
  return (
    <m.span
      className={
        'inline-flex shrink-0 select-none items-center justify-center rounded-md border ' +
        'leading-none font-medium tabular-nums whitespace-nowrap ' +
        (small ? 'h-[20px] px-[6px] text-[10px]' : 'h-[22px] px-[8px] text-[11px]')
      }
      // Colour is the only thing that moves when a service flips state.
      animate={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border }}
    >
      {label}
    </m.span>
  );
}
