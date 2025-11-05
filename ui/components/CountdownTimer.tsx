'use client';

import { useState, useEffect, memo } from 'react';
import { FlipCard } from './FlipCard';

interface CountdownTimerProps {
  endsAt: number;
  onTimerEnd?: () => void;
  isPending?: boolean;
}

export const CountdownTimer = memo(({ endsAt, onTimerEnd, isPending }: CountdownTimerProps) => {
  const [digits, setDigits] = useState<string[]>(['0', '0', '0', '0', '0', '0']);
  const [hasEnded, setHasEnded] = useState(false);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Date.now();
      const diff = endsAt - now;

      if (diff <= 0) {
        setDigits(['0', '0', '0', '0', '0', '0']);
        // Only trigger onTimerEnd if proposal is pending and we haven't already triggered
        if (!hasEnded && isPending) {
          setHasEnded(true);
          onTimerEnd?.();
        }
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const hoursStr = hours.toString().padStart(2, '0');
      const minutesStr = minutes.toString().padStart(2, '0');
      const secondsStr = seconds.toString().padStart(2, '0');

      setDigits([
        hoursStr[0],
        hoursStr[1],
        minutesStr[0],
        minutesStr[1],
        secondsStr[0],
        secondsStr[1],
      ]);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [endsAt, hasEnded, onTimerEnd, isPending]);

  return (
    <div className="flex items-center gap-2">
      {/* Hours */}
      <div className="flex gap-1">
        <FlipCard digit={digits[0]} />
        <FlipCard digit={digits[1]} />
      </div>

      {/* Separator */}
      <span className="text-2xl font-semibold" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>:</span>

      {/* Minutes */}
      <div className="flex gap-1">
        <FlipCard digit={digits[2]} />
        <FlipCard digit={digits[3]} />
      </div>

      {/* Separator */}
      <span className="text-2xl font-semibold" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>:</span>

      {/* Seconds */}
      <div className="flex gap-1">
        <FlipCard digit={digits[4]} />
        <FlipCard digit={digits[5]} />
      </div>
    </div>
  );
});

CountdownTimer.displayName = 'CountdownTimer';
