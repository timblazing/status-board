import { memo } from 'react';
import { m, useReducedMotion } from 'motion/react';

const COLOR: Record<string, string> = {
  o: 'var(--ok)',
  d: 'var(--warn)',
  x: 'var(--bad)',
  '-': 'var(--empty)',
};

interface Props {
  /** Packed one-char-per-slot history, oldest first. */
  history: string;
}

/**
 * The bar strip. Bars are keyed by slot index rather than identity so the
 * strip reads as a fixed window that fills in, not a growing list — and only
 * the slots whose colour actually changed repaint.
 */
export const HistoryBars = memo(function HistoryBars({ history }: Props) {
  const reduce = useReducedMotion();
  const slots = history.split('');
  const newest = slots.length - 1;

  return (
    <div
      className="flex h-[26px] items-stretch gap-[2px] overflow-hidden"
      aria-hidden="true"
    >
      {slots.map((char, i) => (
        <m.span
          key={i}
          className="w-[3px] shrink-0 rounded-[1.5px]"
          // The newest bar grows up from the baseline as it lands.
          initial={i === newest && !reduce ? { scaleY: 0.15, opacity: 0.4 } : false}
          animate={{ scaleY: 1, opacity: 1, backgroundColor: COLOR[char] ?? COLOR['-'] }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          style={{ backgroundColor: COLOR[char] ?? COLOR['-'], transformOrigin: 'bottom' }}
        />
      ))}
    </div>
  );
});
