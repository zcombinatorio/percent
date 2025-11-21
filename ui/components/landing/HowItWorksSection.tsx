interface HowItWorksSectionProps {
  isExpanded: boolean
  onToggle: () => void
}

export default function HowItWorksSection({ isExpanded, onToggle }: HowItWorksSectionProps) {
  return (
    <div className={`mb-8 relative ${isExpanded ? 'border-2 border-white p-2 sm:p-4' : ''}`} style={{backgroundColor: 'black'}}>
      <div style={{backgroundColor: 'black'}} className="h-full w-full relative">
        {/* Title with toggle button */}
        <div className={`${isExpanded ? 'absolute -top-7 left-1/2 transform -translate-x-1/2' : ''} whitespace-nowrap flex items-center gap-2`}>
          <button
            onClick={onToggle}
            className="flex items-center gap-2 px-2 sm:px-4 font-mono text-white tracking-wide text-sm sm:text-lg transition-colors"
            style={{ backgroundColor: 'black' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#ef6300';
              e.currentTarget.style.color = 'black';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'black';
              e.currentTarget.style.color = 'white';
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <span>{isExpanded ? '▾' : '▸'}</span>
            <span>% HOW IT WORKS</span>
          </button>
        </div>
        {isExpanded ? (
          <div className="px-2 sm:px-6 pt-4 pb-0">
            {/* Instructions Text */}
            <div className="font-mono text-xs sm:text-base space-y-1 p-1 sm:p-2" style={{ color: 'white' }}>
              <p className="leading-relaxed">1) Start with points based on your profile stats.</p>
              <p className="leading-relaxed">2) Get more points when your invites earn points and when their invites earn points.</p>
              <p className="leading-relaxed">3) <span className="inline-block" style={{ backgroundColor: '#ef6300', color: 'black', padding: '2px 6px' }}>Invite KOLs and whales</span> <span className="inline-block">→ get a lot of points and move up in the leaderboard.</span></p>
            </div>
            {/* Group 16 SVG - Centered */}
            <div className="flex justify-center mt-2 sm:mt-0">
              <img
                src="/landing/assets/Group 16 from Figma.svg"
                alt="How It Works"
                className="w-[90%] h-auto sm:w-[62.5%]"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
