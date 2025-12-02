import RulerTicker from "./RulerTicker"

export default function HeroSection() {
  return (
    <div className="min-h-screen flex flex-col relative">
      {/* City Skyline Background - Bottom */}
      <div className="absolute bottom-0 left-0 w-full overflow-hidden pointer-events-none z-0">
        <img src="/landing/assets/cityscape-mobile.png" alt="" className="w-full h-auto sm:hidden" />
        <img src="/landing/assets/cityscape.png" alt="" className="w-full h-auto hidden sm:block" />
        {/* Z Combinator Logo Strip */}
        <div className="w-[calc(100%+3rem)] h-12 flex items-center -ml-6 gap-8 mt-2 overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <img key={i} src="/combinator-long.svg" alt="" className="h-11 flex-shrink-0" />
          ))}
        </div>
      </div>

      {/* Ruler Ticker Pattern - 64px */}
      <RulerTicker />

      {/* Content Area - Takes remaining space */}
      <div className="flex-1 flex flex-col justify-start items-center pt-[20vh] p-4 sm:px-8 max-w-3xl mx-auto relative z-10">
      {/* Headline */}
      <h1 className="text-4xl md:text-4xl font-medium text-white text-center mb-4 leading-tight hero-animate delay-300">
        Grow your token network
      </h1>

      {/* Subtitle */}
      <p className="text-base text-gray-400 text-center mb-8 hero-animate-subtle delay-400 sm:max-w-[66.67%]">
        Use markets to decide token distributions that optimize for real growth.
      </p>

      {/* Button */}
      <div className="flex justify-center hero-animate-subtle" style={{ animationDelay: '0.5s' }}>
        <a
          href="/zc"
          className="bg-white text-black px-4 py-1.5 font-medium hover:opacity-90 transition-opacity rounded-full inline-block"
        >
          Enter here
        </a>
      </div>
      </div>
    </div>
  )
}
