import Image from "next/image"

export default function CTASection() {
  return (
    <div className="w-full bg-black flex justify-center pt-24">
      <div className="w-2/3 flex flex-col items-center text-center">
        <div className="mb-6">
          <Image src="/combinator-icon.svg" alt="Z Combinator" width={128} height={148} className="h-32" />
        </div>
        <h2 className="text-3xl font-medium text-white mb-4 animate-on-scroll delay-100">
          The Final Coin
        </h2>
        <p className="text-base text-gray-400 mb-8 animate-on-scroll-subtle delay-200">
          Contribute to ZC today.
        </p>
        <a
          href="/zc"
          className="bg-white text-black px-6 py-2 font-medium hover:opacity-90 transition-opacity rounded-full animate-on-scroll-subtle delay-300 inline-block"
        >
          Enter here
        </a>
      </div>
    </div>
  )
}
