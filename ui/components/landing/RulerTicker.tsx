export default function RulerTicker() {
  return (
    <div className="w-full h-16 diagonal-stripes relative flex-shrink-0 z-10" style={{ backgroundColor: '#0D0D0D' }}>
      <div className="absolute top-0 left-0 w-full h-16 overflow-visible">
        <svg className="absolute left-1/2 -translate-x-1/2" width="200%" height="64" style={{ minWidth: '200vw' }} viewBox="0 0 10000 64" preserveAspectRatio="xMidYMin slice">
          <defs>
            <pattern id="ruler-pattern" x="0" y="0" width="80" height="64" patternUnits="userSpaceOnUse">
              {/* Long tick */}
              <line x1="0" y1="0" x2="0" y2="20" stroke="#494949" strokeWidth="1" />
              {/* Short tick */}
              <line x1="40" y1="0" x2="40" y2="10" stroke="#494949" strokeWidth="1" />
            </pattern>
          </defs>
          {/* Center the pattern so the middle of screen always has a long tick */}
          <rect x="0" y="0" width="10000" height="64" fill="url(#ruler-pattern)" transform="translate(-40, 0)" />
          {/* Center tick - 1.5x length and white */}
          <line x1="5000" y1="0" x2="5000" y2="36" stroke="white" strokeWidth="1" />
          {/* Infinity symbol underneath center tick with gap */}
          <text x="5000" y="60" fill="white" fontSize="32" letterSpacing="0.05em" textAnchor="middle" fontFamily="var(--font-inter), system-ui, sans-serif" className="pulse-text">∞</text>
        </svg>
      </div>
    </div>
  )
}
