import RulerTicker from "./RulerTicker"

export default function HeroSection() {
  return (
    <div className="min-h-screen flex flex-col relative">
      {/* City Skyline Background - Bottom */}
      <div className="absolute bottom-0 left-0 w-full overflow-hidden pointer-events-none z-0">
        <img src="/landing/assets/cityscape-mobile.png" alt="" className="w-full h-auto sm:hidden" />
        <img src="/landing/assets/cityscape.png" alt="" className="w-full h-auto hidden sm:block" />
        {/* Z Combinator Logo Strip */}
        <div className="w-[calc(100%+3rem)] h-12 flex items-center -ml-6 gap-3 mt-2 overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-2 flex-shrink-0">
              <img src="/landing/assets/z-logo-white.png" alt="" className="h-11" />
              <span className="font-semibold text-6xl whitespace-nowrap" style={{ color: '#E9E9E4' }}>Combinator</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ruler Ticker Pattern - 64px */}
      <RulerTicker />

      {/* Content Area - Takes remaining space */}
      <div className="flex-1 flex flex-col justify-start items-center pt-[20vh] p-4 sm:px-8 max-w-3xl mx-auto relative z-10">
      {/* Badge */}
      <div className="mb-4 hero-animate-subtle delay-200">
        <a
          href="https://www.paradigm.xyz/2025/06/quantum-markets"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white hover:bg-white/10 transition-colors"
        >
          FUTARCHY EATS EVERYTHING
        </a>
      </div>

      {/* Headline */}
      <h1 className="text-4xl md:text-4xl font-medium text-white text-center mb-4 leading-tight whitespace-nowrap hero-animate delay-300">
        Zero to Infinity
      </h1>

      {/* Subtitle */}
      <p className="text-base text-gray-400 text-center mb-8 hero-animate-subtle delay-400 sm:max-w-[66.67%]">
        $ZC is the first ever singularity coin, autonomously puppeteering traders and devs to scale itself infinitely.
      </p>

      {/* Button */}
      <div className="flex justify-center hero-animate-subtle" style={{ animationDelay: '0.5s' }}>
        <a
          href="https://zc.percent.markets"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white text-black px-4 py-1.5 font-medium hover:opacity-90 transition-opacity rounded-full inline-block"
        >
          Enter here
        </a>
      </div>
      </div>
    </div>
  )
}
