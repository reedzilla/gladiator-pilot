import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
}

/**
 * Keeps mobile/tablet screen awake while gauges or passive sniffer are active in the Jeep cab.
 */
export function useWakeLock(shouldKeepAwake: boolean): boolean {
  const [awakeLocked, setAwakeLocked] = useState(false);

  useEffect(() => {
    if (!shouldKeepAwake) {
      setAwakeLocked(false);
      return;
    }

    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      try {
        if (cancelled || document.visibilityState !== 'visible') return;
        sentinel = await nav.wakeLock!.request('screen');
        if (!cancelled) {
          setAwakeLocked(true);
          sentinel.addEventListener('release', () => {
            if (!cancelled) setAwakeLocked(false);
          });
        }
      } catch {
        if (!cancelled) setAwakeLocked(false);
      }
    };

    acquire();
    const onVisChange = () => {
      if (document.visibilityState === 'visible' && shouldKeepAwake) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisChange);
      sentinel?.release().catch(() => undefined);
      setAwakeLocked(false);
    };
  }, [shouldKeepAwake]);

  return awakeLocked;
}
