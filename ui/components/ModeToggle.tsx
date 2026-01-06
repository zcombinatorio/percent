'use client';

import { useRef, useEffect, useState } from 'react';

// Parse a small decimal into its components
const parseSmallDecimal = (value: number): { zeroCount: number; sigDigits: string } | null => {
  if (value === 0 || value >= 0.01) return null;

  const str = value.toFixed(10);
  const match = str.match(/^0\.(0+)(\d+)/);

  if (!match) return null;

  return {
    zeroCount: match[1].length,
    sigDigits: match[2].replace(/0+$/, '') || '0'
  };
};

// Format with subscript notation and specified significant digits (includes $)
const formatWithSigDigits = (value: number, maxSigDigits: number): string => {
  if (value === 0) return '$0';
  if (value >= 0.01) return `$${value.toFixed(4)}`;

  const parsed = parseSmallDecimal(value);
  if (!parsed) return `$${value.toFixed(4)}`;

  const { zeroCount, sigDigits } = parsed;
  const paddedDigits = sigDigits.slice(0, maxSigDigits).padEnd(maxSigDigits, '0');

  // Subscript digits: ₀₁₂₃₄₅₆₇₈₉
  const subscripts = '₀₁₂₃₄₅₆₇₈₉';
  const subscriptNum = String(zeroCount).split('').map(d => subscripts[parseInt(d)]).join('');

  return `$0.0${subscriptNum}${paddedDigits}`;
};

// Get max significant digits from an array of values
const getMaxSigDigits = (values: (number | null)[]): number => {
  let max = 1;
  for (const value of values) {
    if (value == null) continue;
    const parsed = parseSmallDecimal(value);
    if (parsed) {
      max = Math.max(max, parsed.sigDigits.length);
    }
  }
  return max;
};

interface ModeToggleProps {
  marketLabels: string[];
  marketCaps: (number | null)[];       // Current TWAP values
  livePrices: (number | null)[];       // Current spot prices
  timeElapsedPercent: number;          // 0-1 representing market progress
  selectedIndex: number;
  onSelect: (index: number) => void;
  solPrice?: number | null;
}

// Parse label to extract display text and optional URL
const parseLabel = (label: string): { displayText: string; url: string | null } => {
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = label.match(urlRegex);
  if (match) {
    const url = match[1];
    const displayText = label.replace(url, '').trim();
    return { displayText: displayText || url, url };
  }
  return { displayText: label, url: null };
};

// Marquee text component for truncated selected items
function MarqueeText({ children, isSelected, isHovered, className, style }: {
  children: React.ReactNode;
  isSelected: boolean;
  isHovered?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [scrollDistance, setScrollDistance] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile vs desktop
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Animation triggers differently based on device:
  // - Mobile: animate when selected
  // - Desktop: animate when hovered
  const shouldTrigger = isMobile ? isSelected : isHovered;

  useEffect(() => {
    if (shouldTrigger && containerRef.current && textRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const textWidth = textRef.current.scrollWidth;
      const overflow = textWidth - containerWidth;

      if (overflow > 0) {
        setShouldAnimate(true);
        setScrollDistance(overflow + 16); // Add some padding
      } else {
        setShouldAnimate(false);
      }
    } else {
      setShouldAnimate(false);
    }
  }, [shouldTrigger, children]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className || ''}`}
      style={style}
    >
      <span
        ref={textRef}
        className={`inline-block whitespace-nowrap ${shouldAnimate ? 'animate-marquee' : ''}`}
        style={shouldAnimate ? {
          '--scroll-distance': `-${scrollDistance}px`,
          animationDuration: `${Math.max(5, scrollDistance / 20)}s`,
        } as React.CSSProperties : undefined}
      >
        {children}
      </span>
    </div>
  );
}

export function ModeToggle({ marketLabels, marketCaps, livePrices, timeElapsedPercent, selectedIndex, onSelect, solPrice }: ModeToggleProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Check if all data has loaded (need TWAP, live prices, and SOL price to compute expected TWAP in USD)
  // Show skeleton until all are ready to avoid reordering flicker
  // Use .every() for livePrices because WebSocket sends prices one market at a time
  const hasTwapData = marketCaps.some(cap => cap != null);
  const hasLivePrices = livePrices.length > 0 && livePrices.every(price => price != null);
  const hasSolPrice = solPrice != null;
  const hasAllData = hasTwapData && hasLivePrices && hasSolPrice;

  // Calculate expected final TWAP for each market
  // Formula: expectedFinal = currentTwap × elapsed% + spotPrice × remaining%
  const expectedFinalTwaps = marketCaps.map((twap, i) => {
    const spotPrice = livePrices[i];
    if (twap == null || spotPrice == null) return null;

    const remainingPercent = 1 - timeElapsedPercent;
    return twap * timeElapsedPercent + spotPrice * remainingPercent;
  });

  // Convert expected final TWAPs from SOL to USD (for sorting)
  const expectedFinalTwapsUsd = expectedFinalTwaps.map(twap =>
    twap != null && solPrice ? twap * solPrice : null
  );

  // Calculate max significant digits across all values for consistent formatting (capped at 4)
  const maxSigDigits = Math.min(getMaxSigDigits(expectedFinalTwapsUsd), 4);

  // Sort indices by expected final TWAP (highest first) for ranking display
  // Only sort once we have all data to avoid reordering flicker
  const sortedIndices = hasAllData
    ? marketLabels
        .map((_, index) => index)
        .sort((a, b) => {
          const aVal = expectedFinalTwapsUsd[a] ?? -Infinity;
          const bVal = expectedFinalTwapsUsd[b] ?? -Infinity;
          return bVal - aVal; // Descending order
        })
    : marketLabels.map((_, index) => index);

  return (
    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300">
      <div className="flex flex-col items-center gap-1 md:gap-4">
        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-2 text-center" style={{ color: '#DDDDD7' }}>
          II. Select Coin (TWAP)
        </span>
        <div className="border border-[#191919] rounded-[6px] py-4 px-6 flex flex-col gap-3 w-full">
          {!hasAllData ? (
            // Loading skeleton - show placeholder rows until all data loads
            marketLabels.map((_, index) => (
              <div key={index} className="flex items-center justify-between select-none">
                <div className="h-6 bg-[#2a2a2a] rounded animate-pulse flex-1 mr-3" style={{ maxWidth: '200px' }} />
                <div className="w-5 h-5 rounded-full border-2 border-[#2a2a2a]" />
              </div>
            ))
          ) : sortedIndices.map((originalIndex, rank) => {
            const label = marketLabels[originalIndex];
            const isSelected = selectedIndex === originalIndex;
            const expectedTwapUsd = expectedFinalTwapsUsd[originalIndex];
            const { displayText, url } = parseLabel(label);

            const labelContent = (
              <>
                {expectedTwapUsd != null ? formatWithSigDigits(expectedTwapUsd, maxSigDigits) : '...'}: {displayText}
              </>
            );

            // Color logic: winning option (rank 0) gets blue, others get white/gray
            const isWinning = rank === 0;
            const textColor = isWinning
              ? (isSelected ? '#BEE8FC' : '#77868C')  // Blue: bright when selected, darker when not
              : (isSelected ? '#FFFFFF' : '#5B5E62'); // White/gray for non-winning

            const isHovered = hoveredIndex === originalIndex;

            return (
              <div
                key={originalIndex}
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => onSelect(originalIndex)}
                onMouseEnter={() => setHoveredIndex(originalIndex)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Label with market cap - clickable if URL exists */}
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`text-lg uppercase transition-colors duration-200 flex-1 min-w-0 mr-3 hover:underline ${
                      !isSelected && !isHovered && 'truncate'
                    }`}
                    style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em', color: textColor }}
                  >
                    <MarqueeText isSelected={isSelected} isHovered={isHovered} className="flex-1 min-w-0">
                      {labelContent}
                    </MarqueeText>
                  </a>
                ) : (
                  <MarqueeText
                    isSelected={isSelected}
                    isHovered={isHovered}
                    className={`text-lg uppercase transition-colors duration-200 flex-1 min-w-0 mr-3 ${
                      !isSelected && !isHovered && 'truncate'
                    }`}
                    style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em', color: textColor }}
                  >
                    {labelContent}
                  </MarqueeText>
                )}

                {/* Toggle Switch (scaled down) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(originalIndex);
                  }}
                  className="relative w-[48px] h-[28px] border-none outline-none overflow-hidden rounded-[14px] transition-all duration-200 cursor-pointer flex-shrink-0"
                  style={{
                    background: '#404346',
                  }}
                >
                  {/* Circle */}
                  <div
                    className="absolute w-[20px] h-[20px] rounded-[12px] transition-all duration-200"
                    style={{
                      top: '4px',
                      left: isSelected ? '24px' : '4px',
                      background: isSelected ? '#DCE0E3' : '#5B5E62',
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
