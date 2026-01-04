'use client';

import { useState, useEffect, memo } from 'react';
import { FlipCard } from './FlipCard';

interface MiniCountdownTimerProps {
  endsAt: number;
}

export const MiniCountdownTimer = memo(({ endsAt }: MiniCountdownTimerProps) => {
  const [digits, setDigits] = useState<string[]>(['0', '0', '0', '0', '0', '0', '0']);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Date.now();
      const diff = endsAt - now;

      if (diff <= 0) {
        setDigits(['0', '0', '0', '0', '0', '0', '0']);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const hoursStr = hours.toString().padStart(3, '0');
      const minutesStr = minutes.toString().padStart(2, '0');
      const secondsStr = seconds.toString().padStart(2, '0');

      setDigits([
        hoursStr[0],
        hoursStr[1],
        hoursStr[2],
        minutesStr[0],
        minutesStr[1],
        secondsStr[0],
        secondsStr[1],
      ]);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [endsAt]);

  return (
    <div className="flex items-center gap-0.5">
      {/* Hours */}
      <div className="flex gap-px">
        <FlipCard digit={digits[0]} size="mini" />
        <FlipCard digit={digits[1]} size="mini" />
        <FlipCard digit={digits[2]} size="mini" />
      </div>

      {/* Separator */}
      <span className="text-xs font-semibold" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>:</span>

      {/* Minutes */}
      <div className="flex gap-px">
        <FlipCard digit={digits[3]} size="mini" />
        <FlipCard digit={digits[4]} size="mini" />
      </div>

      {/* Separator */}
      <span className="text-xs font-semibold" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>:</span>

      {/* Seconds */}
      <div className="flex gap-px">
        <FlipCard digit={digits[5]} size="mini" />
        <FlipCard digit={digits[6]} size="mini" />
      </div>
    </div>
  );
});

MiniCountdownTimer.displayName = 'MiniCountdownTimer';
