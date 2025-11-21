'use client';

import { useState, useRef, useEffect, forwardRef } from 'react';

interface EditableFlipCardProps {
  digit: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onValueEntered?: () => void; // Callback after user types a value
}

const EditableFlipCard = forwardRef<HTMLInputElement, EditableFlipCardProps>(
  ({ digit, onChange, disabled, onValueEntered }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Expose internal ref to parent via forwarded ref
    useEffect(() => {
      if (ref && inputRef.current) {
        if (typeof ref === 'function') {
          ref(inputRef.current);
        } else {
          ref.current = inputRef.current;
        }
      }
    }, [ref]);

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow single digit 0-9
    if (value === '' || /^[0-9]$/.test(value)) {
      onChange(value || '0');
      // Call callback after value is entered (for auto-focus to next input)
      if (value && /^[0-9]$/.test(value) && onValueEntered) {
        onValueEntered();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Arrow up: increment
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const current = parseInt(digit);
      const next = (current + 1) % 10;
      onChange(next.toString());
    }
    // Arrow down: decrement
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const current = parseInt(digit);
      const next = current === 0 ? 9 : current - 1;
      onChange(next.toString());
    }
  };

  return (
    <div
      className={`editable-flip-card-container ${isFocused ? 'focused' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
    >
      {/* Upper Half */}
      <div className="editable-flip-card-upper">
        <span className="editable-flip-card-text">{digit}</span>
      </div>

      {/* Lower Half */}
      <div className="editable-flip-card-lower">
        <span className="editable-flip-card-text">{digit}</span>
      </div>

      {/* Hidden Input */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]"
        value={digit}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        maxLength={1}
        className="editable-flip-card-input"
      />
    </div>
  );
});

EditableFlipCard.displayName = 'EditableFlipCard';

export default EditableFlipCard;
