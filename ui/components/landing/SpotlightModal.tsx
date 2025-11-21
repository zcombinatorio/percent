import { RefObject } from "react"
import TerminalInput, { TerminalInputRef } from "./TerminalInput"
import { AuthState } from "./types"

interface SpotlightModalProps {
  isOpen: boolean
  onClose: () => void
  onShowLeaderboard: () => void
  terminalMessage: string
  referralCode: string
  setReferralCode: (code: string) => void
  onValidateCode: () => void
  authState: AuthState
  isValidating: boolean
  inputRef: RefObject<TerminalInputRef>
  isInputFocused: boolean
  setIsInputFocused: (focused: boolean) => void
}

export default function SpotlightModal({
  isOpen,
  onClose,
  onShowLeaderboard,
  terminalMessage,
  referralCode,
  setReferralCode,
  onValidateCode,
  authState,
  isValidating,
  inputRef,
  isInputFocused,
  setIsInputFocused
}: SpotlightModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose()
        }
      }}
    >
      <div
        className="w-full max-w-2xl diagonal-stripes shadow-2xl animate-scaleIn"
        style={{ backgroundColor: '#0D0D0D', border: '1px solid #494949' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Terminal Output */}
          {terminalMessage && (
            <div className="text-sm mb-4 px-4 py-2" style={{ color: '#EF6300', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
              {terminalMessage}
            </div>
          )}

          {/* Input Section */}
          <div className="bg-black p-6" style={{ border: '1px solid #494949' }}>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Enter invite code</label>
            </div>
            <TerminalInput
              ref={inputRef}
              value={referralCode}
              onChange={setReferralCode}
              onEnter={async () => {
                if (authState.isAuthenticated) {
                  onClose()
                  onShowLeaderboard()
                } else {
                  await onValidateCode()
                  if (referralCode.length === 8) {
                    onClose()
                  }
                }
              }}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              authenticated={authState.isAuthenticated}
              disabled={isValidating}
            />
            <p className="text-center text-gray-600 text-xs mt-4">
              Press <span className="text-white font-medium">ESC</span> to close • <button onClick={() => window.location.href = '/api/auth/twitter?returning=true'} className="text-white underline" style={{ textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Returning?</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
