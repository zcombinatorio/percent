import { useMemo } from 'react';

export interface MarketFocusState {
  isHighlighted: boolean;
  className: string;
}

export interface VisualFocusState {
  entryControls: {
    isHighlighted: boolean;
    className: string;
  };
  tradingInterface: {
    isHighlighted: boolean;
    className: string;
  };
  markets: MarketFocusState[];  // Array for N-ary quantum markets (2-4 options)
}

// Market-specific ring colors for N-ary quantum markets
const MARKET_RING_COLORS = [
  'ring-red-500 shadow-[0_0_20px_rgba(248,113,113,0.4)]',     // Market 0 (red)
  'ring-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]',  // Market 1 (green)
  'ring-blue-500 shadow-[0_0_20px_rgba(96,165,250,0.4)]',     // Market 2 (blue)
  'ring-yellow-500 shadow-[0_0_20px_rgba(251,191,36,0.4)]',   // Market 3 (yellow)
];

/**
 * Hook to manage visual focus states for UI highlighting/dimming
 * Supports N-ary quantum markets (2-4 options)
 *
 * @param hasPosition - Whether user has any position in the market
 * @param selectedMarketIndex - Currently selected market index (0-3)
 * @param marketCount - Total number of markets (2-4)
 * @param proposalStatus - Current status of the proposal
 * @param hasWalletBalance - Whether user has any balance in wallet (SOL or ZC)
 * @returns Object with className and state for each UI section
 */
export function useVisualFocus(
  hasPosition: boolean,
  selectedMarketIndex: number,
  marketCount: number = 2,
  proposalStatus?: 'Pending' | 'Passed' | 'Failed' | 'Executed',
  hasWalletBalance: boolean = true
): VisualFocusState {
  return useMemo(() => {
    // Helper to create market focus states array
    const createMarketStates = (highlighted: number | null, blurred: boolean): MarketFocusState[] => {
      return Array.from({ length: marketCount }, (_, i) => {
        if (blurred) {
          return {
            isHighlighted: false,
            className: 'opacity-40 blur-[2px] transition-all duration-300'
          };
        }
        if (highlighted === i) {
          return {
            isHighlighted: true,
            className: `ring-2 ${MARKET_RING_COLORS[i % MARKET_RING_COLORS.length]} transition-all duration-300`
          };
        }
        return {
          isHighlighted: false,
          className: 'transition-all duration-300'
        };
      });
    };

    // State 0: No Wallet Balance - Blur everything
    if (!hasWalletBalance) {
      return {
        entryControls: {
          isHighlighted: false,
          className: 'opacity-40 blur-[2px] pointer-events-none transition-all duration-300'
        },
        tradingInterface: {
          isHighlighted: false,
          className: 'opacity-40 blur-[2px] pointer-events-none transition-all duration-300'
        },
        markets: createMarketStates(null, true)
      };
    }

    // State 3: Proposal has ended - No blur on anything
    if (proposalStatus && proposalStatus !== 'Pending') {
      return {
        entryControls: {
          isHighlighted: false,
          className: 'transition-all duration-300'
        },
        tradingInterface: {
          isHighlighted: false,
          className: 'transition-all duration-300'
        },
        markets: createMarketStates(null, false)
      };
    }

    // State 1: No Position - Highlight entry controls, dim everything else
    if (!hasPosition) {
      return {
        entryControls: {
          isHighlighted: true,
          className: 'transition-all duration-300'
        },
        tradingInterface: {
          isHighlighted: false,
          className: 'opacity-40 blur-[2px] pointer-events-none transition-all duration-300'
        },
        markets: createMarketStates(null, true)
      };
    }

    // State 2: Has Position - Highlight trading interface and selected market
    return {
      entryControls: {
        isHighlighted: false,
        className: 'transition-all duration-300'
      },
      tradingInterface: {
        isHighlighted: true,
        className: 'transition-all duration-300'
      },
      markets: createMarketStates(selectedMarketIndex, false)
    };
  }, [hasPosition, selectedMarketIndex, marketCount, proposalStatus, hasWalletBalance]);
}
