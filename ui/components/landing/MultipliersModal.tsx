import { X, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"

interface MultipliersModalProps {
  isOpen: boolean
  onClose: () => void
}

interface TokenData {
  hasOGTokens: boolean
  totalPoints: number
  tokens: {
    og: {
      holding: number
      staking: number
    }
    new: {
      holding: number
      staking: number
    }
  }
}

export default function MultipliersModal({ isOpen, onClose }: MultipliersModalProps) {
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch token data when modal opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      fetch('/api/user/tokens')
        .then(res => res.json())
        .then(data => {
          setTokenData(data)
        })
        .catch(err => {
          console.error('Failed to fetch token data:', err)
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [isOpen])

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleEscape)
    }
    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Show loading state
  if (loading) {
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black bg-opacity-75" />
        <div 
          className="relative w-full max-w-md border-2 border-white p-6"
          style={{ backgroundColor: 'black' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="font-mono text-white text-center">Loading token data...</div>
        </div>
      </div>
    )
  }

  // Check if user has Week 1 tokens
  const hasOGTokens = tokenData?.hasOGTokens || false

  // Calculate points from Week 1 tokens
  const ogHoldingPoints = tokenData?.tokens?.og?.holding ? Math.round(tokenData.tokens.og.holding / 42061 * 100) : 0
  const ogStakingPoints = tokenData?.tokens?.og?.staking ? Math.round(tokenData.tokens.og.staking / 32354 * 100) : 0
  const ogTotalPoints = ogHoldingPoints + ogStakingPoints
  
  // Calculate points from NEW tokens
  const newHoldingPoints = tokenData?.tokens?.new?.holding ? Math.round(tokenData.tokens.new.holding / 157728 * 100) : 0
  const newStakingPoints = tokenData?.tokens?.new?.staking ? Math.round(tokenData.tokens.new.staking / 121329 * 100) : 0
  const newTotalPoints = newHoldingPoints + newStakingPoints
  
  // Total points is the sum of all token points
  const totalPoints = ogTotalPoints + newTotalPoints
  
  // Check if user has any tokens at all
  const hasAnyTokens = totalPoints > 0

  // Build token info array with 4 possible components
  const tokenInfo = []
  
  // Week 1 $oogway staker
  if (ogStakingPoints > 0) {
    tokenInfo.push({
      name: "Week 1 $oogway staker",
      points: `${ogStakingPoints.toLocaleString()} points`,
      active: true
    })
  }
  
  // Week 1 $oogway holder
  if (ogHoldingPoints > 0) {
    tokenInfo.push({
      name: "Week 1 $oogway holder",
      points: `${ogHoldingPoints.toLocaleString()} points`,
      active: true
    })
  }
  
  // $oogway staker
  if (newStakingPoints > 0) {
    tokenInfo.push({
      name: "$oogway staker",
      points: `${newStakingPoints.toLocaleString()} points`,
      active: true
    })
  }
  
  // $oogway holder
  if (newHoldingPoints > 0) {
    tokenInfo.push({
      name: "$oogway holder",
      points: `${newHoldingPoints.toLocaleString()} points`,
      active: true
    })
  }
  
  // If user has no tokens at all, show empty state
  if (!hasAnyTokens) {
    tokenInfo.push({
      name: "$oogway holder",
      empty: true,
      active: true
    })
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black bg-opacity-75" />
      
      {/* Modal */}
      <div 
        className="relative w-full max-w-md border-2 border-white p-6"
        style={{ backgroundColor: 'black' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <h2 className="font-mono text-lg text-white mb-6 tracking-wide">MULTIPLIERS - updates every 24h</h2>

        {/* Additional Score - Always show */}
        <div 
          className="border-2 p-4 mb-6"
          style={{
            borderColor: 'rgb(251, 146, 60)',
            backgroundColor: 'rgba(251, 146, 60, 0.1)'
          }}
        >
          <div className="font-mono text-sm text-white mb-2">ADDITIONAL SCORE</div>
          <div className="font-mono text-3xl font-bold" style={{ color: 'rgb(251, 146, 60)' }}>
            {totalPoints.toLocaleString()}
          </div>
        </div>

        {/* Token Info List */}
        <div className="space-y-4">
          {tokenInfo.map((token, idx) => (
            <div 
              key={idx}
              className="border p-4 transition-colors"
              style={{
                borderColor: token.active ? 'rgb(251, 146, 60)' : 'rgba(57, 57, 57, 1)',
                backgroundColor: token.active ? 'rgba(251, 146, 60, 0.05)' : 'rgba(38, 38, 38, 0.5)'
              }}
            >
              <div className="flex justify-between items-center">
                <div 
                  className="font-mono text-sm font-bold"
                  style={{ color: token.active ? 'white' : 'rgba(111, 111, 111, 1)' }}
                >
                  {token.name}
                </div>
                {token.empty ? (
                  <div className="font-mono text-xs" style={{ color: 'rgba(141, 141, 141, 1)' }}>
                    you have no $oogway
                  </div>
                ) : (
                  <div 
                    className="font-mono text-sm font-bold"
                    style={{ color: 'rgb(251, 146, 60)' }}
                  >
                    {token.points}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Link to oogway.xyz - Only show if user has no tokens */}
        {!hasAnyTokens && (
          <a
            href="https://oogway.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-3 font-mono text-sm transition-all duration-200 hover:text-black mt-4"
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(black, black) padding-box, linear-gradient(90deg, #ef6300, #ffcc00, #ff4500, #ef6300, #ffcc00, #ff4500, #ef6300) border-box',
              border: '2px solid transparent',
              color: 'white',
              backgroundSize: '200% 200%',
              textDecoration: 'none'
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
            <span className="flex items-center justify-center gap-2">
              what is $oogway
              <ExternalLink className="w-4 h-4" />
            </span>
          </a>
        )}

        {/* Info text */}
        <p 
          className="mt-4 font-mono text-xs text-center"
          style={{ color: 'rgba(111, 111, 111, 1)' }}
        >
          Multipliers boost your personal score and propagate through your referral network
        </p>
      </div>
    </div>
  )
}