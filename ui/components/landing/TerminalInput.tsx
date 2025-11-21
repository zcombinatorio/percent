"use client"

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'

interface TerminalInputProps {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  autoFocus?: boolean
  authenticated?: boolean
}

export interface TerminalInputRef {
  focus: () => void
}

const TerminalInput = forwardRef<TerminalInputRef, TerminalInputProps>(({
  value,
  onChange,
  onEnter,
  onFocus,
  onBlur,
  placeholder = "ENTER INVITE CODE",
  maxLength = 8,
  disabled = false,
  autoFocus = false,
  authenticated = false
}, ref) => {
  const [isFocused, setIsFocused] = useState(false)
  const [selectionStart, setSelectionStart] = useState(value.length)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayRef = useRef<HTMLDivElement>(null)
  const prevDisabled = useRef(disabled)

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus()
    }
  }))

  // Auto focus on mount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  // Re-focus when disabled state changes from true to false
  useEffect(() => {
    // Only refocus if it was previously disabled (not on initial mount)
    if (prevDisabled.current && !disabled && inputRef.current) {
      // Small delay to ensure the input is fully enabled
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
    prevDisabled.current = disabled
  }, [disabled])

  // Update cursor position when value changes
  useEffect(() => {
    setSelectionStart(Math.min(selectionStart, value.length))
  }, [value])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.toUpperCase()
    if (newValue.length <= maxLength) {
      onChange(newValue)
      setSelectionStart(e.target.selectionStart || 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onEnter()
    }
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement
    setSelectionStart(target.selectionStart || 0)
  }

  const handleFocus = () => {
    setIsFocused(true)
    onFocus?.()
  }

  const handleBlur = () => {
    setIsFocused(false)
    onBlur?.()
  }

  // Split text for cursor positioning
  const beforeCursor = value.slice(0, selectionStart)
  const afterCursor = value.slice(selectionStart)

  // Handle clicking on the display to focus input
  const handleDisplayClick = () => {
    inputRef.current?.focus()
  }

  const displayPlaceholder = authenticated ? "PRESS ENTER" : placeholder

  return (
    <div className="relative">
      {/* Hidden input for actual text entry */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        className="absolute opacity-0 pointer-events-none"
        maxLength={maxLength}
        autoFocus={autoFocus}
      />
      
      {/* Visual display with custom cursor */}
      <div
        ref={displayRef}
        onClick={handleDisplayClick}
        className="flex items-center text-white cursor-text"
      >
        <span className="mr-2" style={{ color: '#EF6300' }}>{'>'}</span>
        <div className="font-mono uppercase tracking-wider">
          {value.length === 0 && !isFocused ? (
            <span className="text-gray-600">{displayPlaceholder}</span>
          ) : (
            <>
              <span className="text-white">{beforeCursor}</span>
              {isFocused && (
                <span
                  className="inline-block align-bottom animate-blink"
                  style={{
                    width: '9px',
                    height: '18px',
                    backgroundColor: '#EF6300',
                    verticalAlign: 'text-bottom'
                  }}
                />
              )}
              <span className="text-white">{afterCursor}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

TerminalInput.displayName = 'TerminalInput'

export default TerminalInput