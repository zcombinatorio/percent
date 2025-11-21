import { Copy, Check } from "lucide-react"
import { AuthState } from "./types"

interface ReferralCodesSectionProps {
  user: AuthState["user"]
  userRank: number | null
  copied: string | null
  onCopy: (text: string, id: string) => void
}

export default function ReferralCodesSection({ user, userRank, copied, onCopy }: ReferralCodesSectionProps) {
  if (!user) return null

  return (
    <div className="border-2 border-white mb-8 relative p-4" style={{backgroundColor: 'black'}}>
      <div style={{backgroundColor: 'black'}} className="h-full w-full relative">
        {/* Title in border */}
        <div className="absolute -top-7 left-1/2 transform -translate-x-1/2">
          <span className="bg-black px-4 font-mono text-white tracking-wide text-lg">% REF CODES</span>
        </div>
        <div className="p-6 pt-8">
        <div className="flex items-center justify-between mb-6">
          <div className="px-3 py-1" style={{ backgroundColor: 'rgb(92, 255, 59)' }}>
            <p className="text-base font-mono text-black font-semibold">
              {user.referralLinks.length > 0 ? "share these to earn points" : "No referral codes available"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-mono italic" style={{color: 'rgba(111, 111, 111, 1)'}}>rank</div>
            <div className="text-sm text-white font-mono tabular-nums">
              #{String(userRank || 0).padStart(3, '0')}
            </div>
          </div>
        </div>
        {user.referralLinks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-2">
          {user.referralLinks.map((link, idx) => (
            <div
              key={idx}
              style={{backgroundColor: 'rgba(38, 38, 38, 1)', border: '1px solid transparent'}}
              className="transition-colors cursor-pointer"
              onClick={() => onCopy(link, `link-${idx}`)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgb(92, 255, 59)';
                const codeDiv = e.currentTarget.querySelector('.ref-code') as HTMLElement;
                if (codeDiv) {
                  codeDiv.style.backgroundColor = 'rgb(92, 255, 59)';
                  codeDiv.style.color = 'black';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'transparent';
                const codeDiv = e.currentTarget.querySelector('.ref-code') as HTMLElement;
                if (codeDiv) {
                  codeDiv.style.backgroundColor = 'rgba(0, 0, 0, 1)';
                  codeDiv.style.color = 'rgba(198, 198, 198, 1)';
                }
              }}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono uppercase tracking-wide" style={{color: 'rgba(111, 111, 111, 1)'}}>
                    ref_{String(idx + 1).padStart(2, '0')}
                  </span>
                  <button
                    onClick={() => onCopy(link, `link-${idx}`)}
                    className="transition-colors"
                    style={{color: 'rgb(92, 255, 59)'}}
                  >
                    {copied === `link-${idx}` ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div
                  className="ref-code text-xs font-mono break-all p-2 border transition-colors"
                  style={{
                    color: 'rgba(198, 198, 198, 1)',
                    backgroundColor: 'rgba(0, 0, 0, 1)',
                    borderColor: 'rgba(57, 57, 57, 1)'
                  }}
                >
                  {link.split('ref=')[1]}
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
        </div>
      </div>
    </div>
  )
}
