import { useMemo } from 'react';

export interface VisualFocusState {
  entryControls: {
    isHighlighted: boolean;
    className: string;
  };
  tradingInterface: {
    isHighlighted: boolean;
    className: string;
  };
  passMarket: {
    isHighlighted: boolean;
    className: string;
  };
  failMarket: {
    isHighlighted: boolean;
    className: string;
  };
}

/**
 * Hook to manage visual focus states for UI highlighting/dimming
 *
 * @param hasPosition - Whether user has any position in the market
 * @param selectedMarket - Currently selected market ('pass' or 'fail')
 * @param proposalStatus - Current status of the proposal
 * @returns Object with className and state for each UI section
 */
export function useVisualFocus(
  hasPosition: boolean,
  selectedMarket: 'pass' | 'fail',
  proposalStatus?: 'Pending' | 'Passed' | 'Failed' | 'Executed'
): VisualFocusState {
  return useMemo(() => {
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
        passMarket: {
          isHighlighted: false,
          className: 'transition-all duration-300'
        },
        failMarket: {
          isHighlighted: false,
          className: 'transition-all duration-300'
        }
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
        passMarket: {
          isHighlighted: false,
          className: 'opacity-40 blur-[2px] transition-all duration-300'
        },
        failMarket: {
          isHighlighted: false,
          className: 'opacity-40 blur-[2px] transition-all duration-300'
        }
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
      passMarket: {
        isHighlighted: selectedMarket === 'pass',
        className: selectedMarket === 'pass'
          ? 'ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-500/10 transition-all duration-300'
          : 'opacity-40 blur-[1px] transition-all duration-300'
      },
      failMarket: {
        isHighlighted: selectedMarket === 'fail',
        className: selectedMarket === 'fail'
          ? 'ring-2 ring-rose-500/30 shadow-lg shadow-rose-500/10 transition-all duration-300'
          : 'opacity-40 blur-[1px] transition-all duration-300'
      }
    };
  }, [hasPosition, selectedMarket, proposalStatus]);
}
