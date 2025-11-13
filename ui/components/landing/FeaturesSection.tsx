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
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Make your PR</h4>
            <p className="text-base text-gray-400 mb-12 animate-on-scroll-subtle delay-200">Come up with an idea to increase $ZC price, build it,<br />
            and make a PR to ZC’s open source Github repo.</p>
            <video src="/landing/assets/zc-percent2.mp4" className="w-full h-auto" autoPlay loop muted playsInline />
          </div>
          {/* Feature 2 */}
          <div>
            <div className="mb-4 animate-on-scroll-subtle">
              <span className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white">
                STEP 2
              </span>
            </div>
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Auto deploy your Quantum Market (QM)</h4>
            <p className="text-base text-gray-400 mb-12 animate-on-scroll-subtle delay-200">ZC automatically spins up a QM to determine if your PR should be merged into production.</p>
            <video src="/landing/assets/deploy3.mp4" className="w-full h-auto" autoPlay loop muted playsInline />
          </div>
          {/* Feature 3 */}
          <div>
            <div className="mb-4 animate-on-scroll-subtle">
              <span className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white">
                STEP 3
              </span>
            </div>
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Invite the ZC community to trade</h4>
            <p className="text-base text-gray-400 mb-12 animate-on-scroll-subtle delay-200">The more community members trade your QM, the fairer the<br />
              chances are of having your PR merged and earning $ZC rewards.</p>
            <video src="/landing/assets/discord2.mp4" className="w-full h-auto" autoPlay loop muted playsInline />
          </div>
          {/* Feature 4 */}
          <div>
            <div className="mb-4 animate-on-scroll-subtle">
              <span className="inline-block px-3 py-1 text-[12px] font-medium tracking-wide uppercase rounded-full border border-white/20 text-white">
                STEP 4
              </span>
            </div>
            <h4 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">Collect your $ZC</h4>
            <p className="text-base text-gray-400 mb-8 animate-on-scroll-subtle delay-200">When your QM settles, collect your $ZC reward and repeat.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
