'use client';

import { useEffect, useState, memo } from 'react';

interface FlipCardProps {
  digit: string;
  size?: 'default' | 'mini';
}

export const FlipCard = memo(function FlipCard({ digit, size = 'default' }: FlipCardProps) {
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [previousDigit, setPreviousDigit] = useState(digit);
  const [isFlipping, setIsFlipping] = useState(false);

  // Class names based on size
  const suffix = size === 'mini' ? '-mini' : '';
  const containerClass = `flip-card-container${suffix}`;
  const upperClass = `flip-card-upper${suffix}`;
  const lowerClass = `flip-card-lower${suffix}`;
  const upperFlipClass = `flip-card-upper-flip${suffix}`;
  const lowerFlipClass = `flip-card-lower-flip${suffix}`;

  useEffect(() => {
    if (digit !== currentDigit) {
      setPreviousDigit(currentDigit);
      setIsFlipping(true);

      // Update digit after flip animation starts
      const timer = setTimeout(() => {
        setCurrentDigit(digit);
        setIsFlipping(false);
      }, 300); // Half of the 600ms animation

      return () => clearTimeout(timer);
    }
  }, [digit, currentDigit]);

  return (
    <div className={containerClass}>
      {/* Static upper half */}
      <div className={upperClass}>
        <span>{currentDigit}</span>
      </div>

      {/* Static lower half */}
      <div className={lowerClass}>
        <span>{currentDigit}</span>
      </div>

      {/* Animated flip layer (only visible during flip) */}
      {isFlipping && (
        <>
          {/* Upper half that flips down */}
          <div className={upperFlipClass}>
            <span>{previousDigit}</span>
          </div>

          {/* Lower half that gets revealed */}
          <div className={lowerFlipClass}>
            <span>{currentDigit}</span>
          </div>
        </>
      )}
    </div>
  );
});
