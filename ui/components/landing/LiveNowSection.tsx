export default function LiveNowSection() {
  return (
    <div className="w-full bg-black flex flex-col items-center border-t border-white/10 pt-28 mt-2">
      <div className="text-center px-3 sm:px-8 pb-16">
        {/* Badge */}
        <div className="mb-4 inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white animate-on-scroll-subtle">
            Fair token networks
        </div>
        <h2 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Futarchy for governance</h2>
        <p className="text-gray-400 max-w-lg mb-0 animate-on-scroll-subtle delay-200">
          One-click markets evaluate proposals, identify the optimal decision, and execute accordingly.
        </p>
      </div>
      <div className="w-full overflow-hidden relative pt-16">
        <img src="/landing/assets/overbuildings.png" alt="" className="w-full h-auto" />
        {/* Frosted glass overlay */}
        <div className="absolute inset-0 flex items-end justify-center px-3 sm:px-0">
          <div className="w-full sm:w-2/3 h-full">
            <div className="w-full h-full backdrop-blur-md bg-white/10"></div>
          </div>
        </div>
        {/* Mockup overlay */}
        <div className="absolute inset-0 flex items-end justify-center px-3 sm:px-0">
          <div className="w-full sm:w-2/3 h-full flex items-center justify-center">
            <img src="/landing/assets/mockup.svg" alt="Mockup" className="max-w-full max-h-full select-none" draggable="false" onContextMenu={(e) => e.preventDefault()} />
          </div>
        </div>
      </div>
    </div>
  )
}
