/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Percent Protocol (the "Software").
 *
 * Unauthorized use, reproduction, or distribution of this Software,
 * or any portion of it, may result in severe civil and criminal penalties,
 * and will be prosecuted to the maximum extent possible under the law.
 *
 * THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 * See the LICENSE file in the project root for full license details.
 */

"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import Header from "@/components/landing/Header"
import HeroSection from "@/components/landing/HeroSection"
import LiveNowSection from "@/components/landing/LiveNowSection"
import FeaturesSection from "@/components/landing/FeaturesSection"
import TokenCarousel from "@/components/landing/TokenCarousel"
import CTASection from "@/components/landing/CTASection"
import Footer from "@/components/landing/Footer"

export default function LandingPage() {
  const router = useRouter()
  const carouselRef = useRef<HTMLDivElement>(null)
  const [currentCard, setCurrentCard] = useState(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Carousel placeholder data
  const carouselItems = [
    { title: '3,456,000 $ZC', subtitle: 'PR #001' },
    { title: '7,234,000 $ZC', subtitle: 'PR #014' },
    { title: '2,891,000 $ZC', subtitle: 'PR #045' },
    { title: '5,672,000 $ZC', subtitle: 'PR #101' },
    { title: '9,123,000 $ZC', subtitle: 'PR #103' },
  ]

  // Carousel functions
  const scrollCarouselRight = () => {
    if (carouselRef.current && currentCard < carouselItems.length - 1) {
      const nextIndex = currentCard + 1
      setCurrentCard(nextIndex)
      const cardWidth = window.innerWidth < 640 ? 360 : 400
      const gap = 24 // gap-6 = 24px
      const containerWidth = carouselRef.current.clientWidth
      const scrollLeft = nextIndex * (cardWidth + gap) - (containerWidth - cardWidth) / 2
      carouselRef.current.scrollTo({
        left: scrollLeft,
        behavior: 'smooth'
      })
    }
  }

  const scrollCarouselLeft = () => {
    if (carouselRef.current && currentCard > 0) {
      const prevIndex = currentCard - 1
      setCurrentCard(prevIndex)
      const cardWidth = window.innerWidth < 640 ? 360 : 400
      const gap = 24 // gap-6 = 24px
      const containerWidth = carouselRef.current.clientWidth
      const scrollLeft = prevIndex * (cardWidth + gap) - (containerWidth - cardWidth) / 2
      carouselRef.current.scrollTo({
        left: scrollLeft,
        behavior: 'smooth'
      })
    }
  }

  const handleCarouselScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    scrollTimeoutRef.current = setTimeout(() => {
      if (carouselRef.current) {
        const scrollLeft = carouselRef.current.scrollLeft
        const clientWidth = carouselRef.current.clientWidth
        const cardWidth = window.innerWidth < 640 ? 360 : 400
        const gap = 24 // gap-6 = 24px

        // Calculate which card is closest to center
        const centerOffset = (clientWidth - cardWidth) / 2
        let newIndex = Math.round((scrollLeft + centerOffset) / (cardWidth + gap))

        // Clamp to valid range
        newIndex = Math.max(0, Math.min(carouselItems.length - 1, newIndex))

        setCurrentCard(newIndex)
      }
    }, 50)
  }, [carouselItems.length])

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observerOptions = {
      threshold: 0.15,
      rootMargin: '0px 0px -10% 0px'
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in')
        }
      })
    }, observerOptions)

    // Observe all animation elements
    const elements = document.querySelectorAll('.animate-on-scroll, .animate-on-scroll-subtle, .animate-on-scroll-scale')
    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [])

  return (
    <div className="fixed inset-0 text-white overflow-hidden flex justify-center diagonal-stripes" style={{ backgroundColor: '#0D0D0D' }}>
      <div className="w-full max-w-[1512px] bg-black relative" style={{ borderLeft: '1px solid #494949', borderRight: '1px solid #494949' }}>
        {/* Sticky Header */}
        <Header />

        {/* Main Landing Page */}
        <div className="h-full w-full flex flex-col overflow-y-auto overflow-x-hidden pt-[60px]">
          {/* Hero Section */}
          <HeroSection />

          {/* Live Now Section */}
          <LiveNowSection />

          {/* Features Section */}
          <FeaturesSection />

          {/* CTA Section */}
          <div className="w-full bg-black flex justify-center px-3 sm:px-6">
            <div className="w-full sm:w-2/3">
              <CTASection />
            </div>
          </div>

          {/* Footer */}
          <Footer />
        </div>
      </div>
    </div>
  )
}
