import Image from "next/image"

export default function Footer() {
  return (
    <div className="w-full bg-black pt-28 px-3 sm:px-6">
      {/* Divider line */}
      <div className="w-full flex justify-center mb-16">
        <div className="w-full sm:w-2/3 border-t border-white/10"></div>
      </div>

      {/* Footer content */}
      <div className="w-full flex justify-center">
        <div className="w-full sm:w-2/3 flex justify-between items-start">
          {/* Logo, Tagline, and Button */}
          <div className="flex flex-col">
            <div className="mb-4">
              <div className="text-2xl font-semibold flex items-baseline gap-2">
                <Image
                  src="/landing/assets/z-logo-white.png"
                  alt="Z"
                  width={19}
                  height={19}
                  className="mb-0"
                />
                <span style={{ color: '#E9E9E4' }}>Combinator</span>
              </div>
            </div>
            <p className="text-gray-400 text-sm mb-4 -mt-2.5">Zero to Infinity</p>
          </div>

          {/* Footer Links */}
          <div className="flex gap-8 sm:gap-16 items-start">
            {/* Token Column */}
            <div>
              <h5 className="text-white text-sm font-medium mb-4">Token</h5>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://axiom.trade/meme/CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad?chain=sol"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    $ZC
                  </a>
                </li>
              </ul>
            </div>

            {/* Resources Column */}
            <div>
              <h5 className="text-white text-sm font-medium mb-4">Info</h5>
              <ul className="space-y-2">
                <li><a href="https://docs.percent.markets/" target="_blank" rel="noopener noreferrer" className="text-gray-400 text-sm hover:text-white transition-colors">Docs</a></li>
                <li><a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="text-gray-400 text-sm hover:text-white transition-colors">GitHub</a></li>
              </ul>
            </div>

            {/* Contact Column */}
            <div>
              <h5 className="text-white text-sm font-medium mb-4">Contact</h5>
              <ul className="space-y-2">
                <li><a href="https://x.com/percentmarkets" target="_blank" rel="noopener noreferrer" className="text-gray-400 text-sm hover:text-white transition-colors">Twitter</a></li>
                <li><a href="http://discord.gg/zcombinator" target="_blank" rel="noopener noreferrer" className="text-gray-400 text-sm hover:text-white transition-colors">Discord</a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="w-screen overflow-hidden relative left-1/2 -translate-x-1/2">
        <img src="/landing/assets/citypark-mobile.png" alt="" className="w-full h-auto select-none sm:hidden" draggable="false" onContextMenu={(e) => e.preventDefault()} />
        <img src="/landing/assets/citypark.png" alt="" className="w-full h-auto select-none hidden sm:block" draggable="false" onContextMenu={(e) => e.preventDefault()} />
      </div>
    </div>
  )
}
