'use client';

import { useEffect, useState, memo } from 'react';

interface FlipCardProps {
  digit: string;
}

export const FlipCard = memo(function FlipCard({ digit }: FlipCardProps) {
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [previousDigit, setPreviousDigit] = useState(digit);
  const [isFlipping, setIsFlipping] = useState(false);

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
    <div className="flip-card-container">
      {/* Static upper half */}
      <div className="flip-card-upper">
        <span>{currentDigit}</span>
      </div>

      {/* Static lower half */}
      <div className="flip-card-lower">
        <span>{currentDigit}</span>
      </div>

      {/* Animated flip layer (only visible during flip) */}
      {isFlipping && (
        <>
          {/* Upper half that flips down */}
          <div className="flip-card-upper-flip">
            <span>{previousDigit}</span>
          </div>

          {/* Lower half that gets revealed */}
          <div className="flip-card-lower-flip">
            <span>{currentDigit}</span>
          </div>
        </>
      )}
    </div>
  );
});
