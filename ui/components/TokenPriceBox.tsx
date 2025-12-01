'use client';

import React, { useState } from 'react';
import { CgSpaceBetween } from 'react-icons/cg';

interface TokenPriceBoxProps {
  tokenName: string;
  tokenSymbol: string;
  tokenAddress?: string;
  price: number | null;
  twap?: number | null;           // TWAP for N-ary markets
  priceChange24h?: number;
  isLoading?: boolean;
  tokenType?: 'governance' | 'pass' | 'fail' | 'gap' | 'market';
  marketIndex?: number;           // For N-ary market coloring
  isLast?: boolean;               // For border styling on last item
}

export const TokenPriceBox: React.FC<TokenPriceBoxProps> = ({
  tokenName,
  tokenSymbol,
  tokenAddress,
  price,
  twap,
  priceChange24h,
  isLoading = false,
  tokenType = 'governance',
  marketIndex,
  isLast = false
}) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    if (tokenAddress) {
      navigator.clipboard.writeText(tokenAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const getTypeStyles = () => {
    const baseStyles = 'border-t border-l border-b border-[#282828]';

    // For N-ary markets, add right border only on last item
    if (tokenType === 'market') {
      return isLast ? `${baseStyles} border-r` : baseStyles;
    }

    switch (tokenType) {
      case 'governance':
        return baseStyles;
      case 'pass':
        return baseStyles;
      case 'fail':
        return baseStyles;
      case 'gap':
        return `${baseStyles} border-r`;
      default:
        return baseStyles;
    }
  };

  const getTypeIcon = () => {
    // For N-ary markets, use index-based colored numbered circles
    if (tokenType === 'market' && marketIndex !== undefined) {
      const colors = ['#f87171', '#34d399', '#60a5fa', '#fbbf24']; // red, green, blue, yellow
      return (
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: colors[marketIndex % colors.length] }}
        >
          {marketIndex + 1}
        </div>
      );
    }

    switch (tokenType) {
      case 'pass':
        return (
          <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'fail':
        return (
          <svg className="w-5 h-5 text-rose-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      case 'gap':
        return <CgSpaceBetween className="w-5 h-5 text-theme-text-secondary" />;
      default:
        return (
          <img
            src="https://www.oogway.xyz/icon.jpeg"
            alt="ZC"
            className="w-5 h-5 rounded-full"
          />
        );
    }
  };

  const formatPrice = (value: number) => {
    if (tokenType === 'gap') {
      return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    }
    return `$${value.toFixed(7)}`;
  };

  const formatPriceChange = (change: number) => {
    const isPositive = change >= 0;
    const color = isPositive ? 'text-green-500' : 'text-red-500';
    const arrow = isPositive ? '↑' : '↓';
    return (
      <span className={color}>
        {arrow} {Math.abs(change).toFixed(2)}%
      </span>
    );
  };

  return (
    <div className={`p-4 transition-all hover:border-[#282828] ${getTypeStyles()}`}>
      <div className="flex items-center justify-between mb-2">
        <div 
          className={`flex items-center gap-2 ${tokenAddress ? 'group cursor-pointer' : ''}`}
          onClick={tokenAddress ? handleCopy : undefined}
        >
          {getTypeIcon()}
          <div className="flex items-center gap-1">
            <h3 className={`text-sm font-semibold text-gray-200 ${tokenAddress ? 'group-hover:text-gray-100 transition-colors' : ''}`}>
              {tokenName}
            </h3>
            {tokenAddress && (
              <div className="relative">
                {copied ? (
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-theme-text-disabled group-hover:text-theme-text-secondary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="mt-3">
        {isLoading ? (
          <div className="animate-pulse">
            <div className="h-8 bg-[#2A2A2A] rounded w-24 mb-2"></div>
            <div className="h-4 bg-[#2A2A2A] rounded w-16"></div>
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold text-gray-100">
              {price !== null ? (
                formatPrice(price)
              ) : tokenType === 'gap' ? (
                <span className="text-lg text-[#6b7280]">No TWAP Data</span>
              ) : (
                '--'
              )}
            </div>
            {priceChange24h !== undefined && (
              <div className="text-sm mt-1">
                {formatPriceChange(priceChange24h)}
              </div>
            )}
            {/* TWAP display for N-ary markets */}
            {tokenType === 'market' && twap !== null && (
              <div className="text-sm mt-1" style={{ color: '#9ca3af' }}>
                TWAP: {(twap * 100).toFixed(2)}%
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};