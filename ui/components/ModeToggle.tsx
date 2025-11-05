'use client';

interface ModeToggleProps {
  isPassMode: boolean;
  onToggle: (isPassMode: boolean) => void;
  pfgPercentage: number | null;
}

export function ModeToggle({ isPassMode, onToggle, pfgPercentage }: ModeToggleProps) {
  const handleToggleClick = () => {
    onToggle(!isPassMode);
  };

  const handleDarkClick = () => {
    onToggle(true);
  };

  const handleLightClick = () => {
    onToggle(false);
  };

  return (
    <div className="bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-6 px-5 hover:border-[#2A2A2A] transition-all duration-300">
      <div className="flex flex-col items-center gap-4">
        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-4" style={{ color: '#DDDDD7' }}>
          Toggle Market
        </span>
        <div className="inline-flex flex-row items-center select-none">
        {/* Dark Label */}
        <h6
          className={`text-md uppercase pr-6 py-3 min-w-[48px] cursor-pointer transition-colors duration-200 flex items-center gap-2.5 ${
            isPassMode
              ? 'text-[#FFFFFF] pointer-events-none'
              : 'text-[#5B5E62] hover:text-[#404346] active:text-[#010101]'
          }`}
          onClick={handleDarkClick}
          style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
        >
          PASS COIN
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 20 20" strokeWidth="1.5">
            <circle cx="10" cy="10" r="8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l2 2 4-4" />
          </svg>
        </h6>

        {/* Toggle Switch */}
        <button
          onClick={handleToggleClick}
          className="relative w-[72px] h-[42px] border-none outline-none overflow-hidden rounded-[21px] transition-all duration-200 cursor-pointer"
          style={{
            background: isPassMode ? '#F8F8F8' : '#404346',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isPassMode ? '#FCFEFE' : '#2D2F31';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isPassMode ? '#F8F8F8' : '#404346';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.background = isPassMode ? '#E8E8E8' : '#141516';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.background = isPassMode ? '#FCFEFE' : '#2D2F31';
          }}
        >
          {/* Circle */}
          <div
            className="absolute w-[30px] h-[30px] rounded-[18px] transition-all duration-200"
            style={{
              top: '6px',
              left: isPassMode ? '6px' : '36px',
              background: isPassMode ? '#2D2F31' : '#DCE0E3',
            }}
          />

          {/* Decorative Element (after pseudo) */}
          <div
            className="absolute rounded-full transition-all duration-200"
            style={
              isPassMode
                ? {
                    top: '-3px',
                    right: '3px',
                    width: '48px',
                    height: '48px',
                    borderRadius: '24px',
                    background: '#F8F8F8',
                  }
                : {
                    top: '21px',
                    right: '3px',
                    width: '1.5px',
                    height: '1.5px',
                    borderRadius: '0.75px',
                    background: '#404346',
                  }
            }
          />
        </button>

        {/* Light Label */}
        <h6
          className={`text-md uppercase pl-6 py-3 min-w-[48px] cursor-pointer transition-colors duration-200 flex items-center gap-2.5 ${
            isPassMode
              ? 'text-[#B9BDC1] hover:text-[#FCFEFE] active:text-[#CDD1D5]'
              : 'text-[#5B5E62] pointer-events-none'
          }`}
          onClick={handleLightClick}
          style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
        >
          FAIL COIN
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 20 20" strokeWidth="1.5">
            <circle cx="10" cy="10" r="8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l6 6M13 7l-6 6" />
          </svg>
        </h6>
      </div>

      {/* PFG Value */}
      <div
        className="text-md py-2"
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          letterSpacing: '0em',
          color: isPassMode ? '#FFFFFF' : '#5B5E62',
        }}
      >
        PFG {pfgPercentage !== null ? pfgPercentage.toFixed(2) : '0.00'}%
      </div>
      </div>
    </div>
  );
}
