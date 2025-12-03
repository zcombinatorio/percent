export default function FeaturesSection() {
  return (
    <div className="w-full bg-black flex justify-center pt-28 px-3 sm:px-6">
      <div className="w-full sm:w-2/3">
        <div className="space-y-28">
          {/* Feature 1 */}
          <div>
            <div className="mb-4 animate-on-scroll-subtle">
              <span className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white">
                STEP 1
              </span>
            </div>
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Raise Capital</h4>
            <p className="text-base text-gray-400 mb-12 animate-on-scroll-subtle delay-200">Launch or migrate your token with our token sale API. Build a community of traders for your markets.</p>
            <video src="/landing/assets/zc-percent2.mp4" className="w-full h-auto" autoPlay loop muted playsInline />
          </div>
          {/* Feature 2 */}
          <div>
            <div className="mb-4 animate-on-scroll-subtle">
              <span className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white">
                STEP 2
              </span>
            </div>
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Auto-deploy quantum markets</h4>
            <p className="text-base text-gray-400 mb-12 animate-on-scroll-subtle delay-200">Let markets decide instead of guessing. Spin up a quantum market for emission rates, incentive distributions, treasury management, fundraise dynamics, retroactive funding, and more.</p>
            <video src="/landing/assets/deploy3.mp4" className="w-full h-auto" autoPlay loop muted playsInline />
          </div>
          {/* Feature 3 */}
          <div>
            <div className="mb-4 animate-on-scroll-subtle">
              <span className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white">
                STEP 3
              </span>
            </div>
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Invite the Combinator community to trade</h4>
            <p className="text-base text-gray-400 mb-12 animate-on-scroll-subtle delay-200">More traders means better signal. The community trades your markets to surface what drives growth.</p>
            <video src="/landing/assets/discord2.mp4" className="w-full h-auto" autoPlay loop muted playsInline />
          </div>
        </div>
      </div>
    </div>
  )
}
