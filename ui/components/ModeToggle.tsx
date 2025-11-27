'use client';

import { formatMarketCap } from '@/lib/formatters';

interface ModeToggleProps {
  marketLabels: string[];
  marketCaps: (number | null)[];
  selectedIndex: number;
  onSelect: (index: number) => void;
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

export function ModeToggle({ marketLabels, marketCaps, selectedIndex, onSelect }: ModeToggleProps) {
  return (
    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300">
      <div className="flex flex-col items-center gap-1 md:gap-4">
        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-2 text-center" style={{ color: '#DDDDD7' }}>
          II. Select Coin
        </span>
        <div className="border border-[#191919] rounded-[6px] py-4 px-6 flex flex-col gap-3 w-full">
          {marketLabels.map((label, index) => {
            const isSelected = selectedIndex === index;
            const marketCap = marketCaps[index];
            const { displayText, url } = parseLabel(label);

            const labelContent = (
              <>
                {index + 1}. {displayText} ({formatMarketCap(marketCap)})
              </>
            );

            return (
              <div
                key={index}
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => onSelect(index)}
              >
                {/* Label with market cap - clickable if URL exists */}
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`text-lg uppercase transition-colors duration-200 truncate flex-1 min-w-0 mr-3 hover:underline ${
                      isSelected ? 'text-[#FFFFFF]' : 'text-[#5B5E62]'
                    }`}
                    style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
                  >
                    {labelContent}
                  </a>
                ) : (
                  <div
                    className={`text-lg uppercase transition-colors duration-200 truncate flex-1 min-w-0 mr-3 ${
                      isSelected ? 'text-[#FFFFFF]' : 'text-[#5B5E62]'
                    }`}
                    style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
                  >
                    {labelContent}
                  </div>
                )}

                {/* Toggle Switch (scaled down) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(index);
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
