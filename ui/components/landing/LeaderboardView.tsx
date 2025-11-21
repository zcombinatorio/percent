import { LeaderboardUser, AuthState } from "./types"
import HowItWorksSection from "./HowItWorksSection"
import ReferralCodesSection from "./ReferralCodesSection"
import LeaderboardTable from "./LeaderboardTable"

interface LeaderboardViewProps {
  authState: AuthState
  userRank: number | null
  leaderboardData: LeaderboardUser[]
  onBack: () => void
  copied: string | null
  onCopy: (text: string, id: string) => void
  formatNumber: (num: number) => string
  totalPages: number
  currentPage: number
  onPageChange: (page: number) => void
  isHowItWorksExpanded: boolean
  onToggleHowItWorks: () => void
  showMultipliersModal: boolean
  setShowMultipliersModal: (show: boolean) => void
}

export default function LeaderboardView({
  authState,
  userRank,
  leaderboardData,
  onBack,
  copied,
  onCopy,
  formatNumber,
  totalPages,
  currentPage,
  onPageChange,
  isHowItWorksExpanded,
  onToggleHowItWorks,
  showMultipliersModal,
  setShowMultipliersModal
}: LeaderboardViewProps) {
  return (
    <div className="h-full w-full bg-black overflow-auto pt-[60px]">
      <div className="max-w-6xl mx-auto p-4">
        {/* Header with Logo and Logout */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <a
              href="https://x.com/percentmarkets"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
            >
              <img src="/landing/assets/favicon.svg" alt="%" className="w-7 h-7" />
            </a>
            <span className="text-white font-mono text-lg">Phase 1</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowMultipliersModal(true)}
              className="relative font-mono text-sm transition-all duration-200 hover:text-black rainbow-border"
              style={{
                padding: '8px 16px',
                background: 'linear-gradient(black, black) padding-box, linear-gradient(90deg, #ef6300, #ffcc00, #ff4500, #ef6300, #ffcc00, #ff4500, #ef6300) border-box',
                border: '2px solid transparent',
                color: 'white',
                backgroundSize: '200% 200%'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(white, white) padding-box, linear-gradient(90deg, #ef6300, #ffcc00, #ff4500, #ef6300, #ffcc00, #ff4500, #ef6300) border-box';
                e.currentTarget.style.backgroundSize = '200% 200%';
                e.currentTarget.style.color = 'black';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(black, black) padding-box, linear-gradient(90deg, #ef6300, #ffcc00, #ff4500, #ef6300, #ffcc00, #ff4500, #ef6300) border-box';
                e.currentTarget.style.backgroundSize = '200% 200%';
                e.currentTarget.style.color = 'white';
              }}
            >
              multipliers
            </button>
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={async () => {
                  await fetch('/api/auth/session', { method: 'DELETE' })
                  window.location.href = '/'
                }}
                className="font-mono text-sm italic transition-colors" style={{color: 'rgba(111, 111, 111, 1)'}} onMouseEnter={(e) => (e.target as HTMLElement).style.color = 'white'} onMouseLeave={(e) => (e.target as HTMLElement).style.color = 'rgba(111, 111, 111, 1)'}
              >
                logout
              </button>
            )}
          </div>
        </div>

        {/* How It Works Section - Sacred Terminal Theme with Accordion */}
        <HowItWorksSection
          isExpanded={isHowItWorksExpanded}
          onToggle={onToggleHowItWorks}
        />

        {/* Gradient Divider - Only show when How It Works is expanded */}
        {isHowItWorksExpanded && (
          <div className="gradient my-8"></div>
        )}

        {/* User's Referral Links - Sacred Terminal Theme */}
        <ReferralCodesSection
          user={authState.user}
          userRank={userRank}
          copied={copied}
          onCopy={onCopy}
        />

        {/* Gradient Divider */}
        <div className="gradient my-8"></div>

        {/* Leaderboard Table - Sacred Black Midnight Vapor Theme */}
        <LeaderboardTable
          leaderboardData={leaderboardData}
          authState={authState}
          userRank={userRank}
          formatNumber={formatNumber}
        />

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center mt-8 gap-4">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 font-mono text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                color: currentPage === 1 ? 'rgba(111, 111, 111, 0.5)' : 'rgba(111, 111, 111, 1)',
                backgroundColor: 'rgba(38, 38, 38, 1)',
                border: '1px solid rgba(57, 57, 57, 1)'
              }}
            >
              prev
            </button>

            <span className="font-mono text-sm" style={{color: 'rgba(111, 111, 111, 1)'}}>
              {currentPage} / {totalPages}
            </span>

            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 font-mono text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                color: currentPage === totalPages ? 'rgba(111, 111, 111, 0.5)' : 'rgba(111, 111, 111, 1)',
                backgroundColor: 'rgba(38, 38, 38, 1)',
                border: '1px solid rgba(57, 57, 57, 1)'
              }}
            >
              next
            </button>
          </div>
        )}

        {/* Back to Home - Terminal Style */}
        <div className="text-center mt-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 font-mono text-sm italic transition-colors group" style={{color: 'rgba(111, 111, 111, 1)'}} onMouseEnter={(e) => (e.target as HTMLElement).style.color = '#2d70fa'} onMouseLeave={(e) => (e.target as HTMLElement).style.color = 'rgba(111, 111, 111, 1)'}
          >
            <span className="block-loader inline-block font-mono"></span>
            <span>back to terminal</span>
          </button>
        </div>
      </div>
    </div>
  )
}
