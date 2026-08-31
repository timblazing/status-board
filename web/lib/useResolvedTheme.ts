import { useEffect, useState } from 'react';
import type { StatusSnapshot } from '@shared/types.ts';

/**
 * Whether the board is currently painting dark, for the things that need it in
 * JS rather than CSS — svgl ships separate light and dark logo files, and an
 * <img src> can't be chosen by media query the way a colour token can.
 */
export function useResolvedTheme(theme: StatusSnapshot['theme'] | undefined): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (theme !== 'system') {
      setDark(theme === 'dark');
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setDark(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return dark;
}
