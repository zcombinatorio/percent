import { RefObject } from "react"

interface CarouselItem {
  title: string
  subtitle: string
}

interface TokenCarouselProps {
  carouselRef: RefObject<HTMLDivElement | null>
  currentCard: number
  items: CarouselItem[]
  onScrollLeft: () => void
  onScrollRight: () => void
  onScroll: () => void
}

export default function TokenCarousel({
  carouselRef,
  currentCard,
  items,
  onScrollLeft,
  onScrollRight,
  onScroll
}: TokenCarouselProps) {
  return (
    <div className="w-full bg-black">
      <div className="relative">
        {/* Gradient overlays for fade effect */}
        {currentCard > 0 && (
          <div className="absolute left-0 -top-4 -bottom-4 w-12 sm:w-32 bg-gradient-to-r from-black to-transparent z-20 pointer-events-none -ml-4"></div>
        )}
        {currentCard < items.length - 1 && (
          <div className="absolute right-0 -top-4 -bottom-4 w-12 sm:w-32 bg-gradient-to-l from-black to-transparent z-20 pointer-events-none -mr-4"></div>
        )}

        {/* Carousel container */}
        <div
          ref={carouselRef}
          className="flex gap-6 overflow-x-auto overflow-y-visible scrollbar-hide scroll-smooth py-4 px-4 -mx-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onScroll={onScroll}
        >
          {items.map((item, index) => (
            <div
              key={index}
              className="flex-shrink-0 w-[360px] sm:w-[400px] min-h-[250px] bg-white/5 relative overflow-hidden transition-transform duration-300 hover:scale-105"
              style={{ border: '1px solid #494949' }}
            >
              <div className="p-6 flex flex-col h-full items-center justify-center text-center">
                <h4 className="text-xl font-medium text-white mb-2">{item.title}</h4>
                <p className="text-sm text-gray-400 mb-4">{item.subtitle}</p>
                <button className="bg-white text-black px-6 py-2 font-medium hover:opacity-90 transition-opacity rounded-full">
                  Claim
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Navigation buttons */}
        {currentCard > 0 && (
          <button
            onClick={onScrollLeft}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors z-20"
            style={{ border: '1px solid #494949' }}
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {currentCard < items.length - 1 && (
          <button
            onClick={onScrollRight}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors z-20"
            style={{ border: '1px solid #494949' }}
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
