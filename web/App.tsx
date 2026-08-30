import { useEffect, useRef } from 'react';
import { domAnimation, LazyMotion } from 'motion/react';
import { StatusCard } from './components/StatusCard.tsx';
import { useStatus } from './lib/useStatus.ts';

export function App() {
  const { data, error, fetchedAt } = useStatus();
  // Rows stagger in once; later refreshes must not re-animate the list.
  const firstPaint = useRef(true);

  useEffect(() => {
    if (data) firstPaint.current = false;
  }, [data]);

  useEffect(() => {
    if (data) document.title = data.title;
  }, [data?.title]);

  return (
    // domAnimation is the smallest feature set that covers our transform and
    // colour tweens — the full `motion` bundle would triple the payload.
    <LazyMotion features={domAnimation} strict>
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        {data ? (
          <StatusCard
            data={data}
            fetchedAt={fetchedAt}
            stale={error}
            firstPaint={firstPaint.current}
          />
        ) : (
          <p className="font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
            {error ? 'could not reach the status service' : 'loading…'}
          </p>
        )}
      </div>
    </LazyMotion>
  );
}
