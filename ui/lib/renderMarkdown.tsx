'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownTextProps {
  children: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders text with basic markdown support (bold, italic, links)
 * Designed to match existing styling while adding formatting support
 */
export function MarkdownText({ children, className, style }: MarkdownTextProps) {
  // Handle empty/undefined content
  if (!children) {
    return null;
  }

  return (
    <span className={`break-words ${className || ''}`} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Render paragraphs as spans to avoid block-level styling issues
          p: ({ children }) => <span>{children}</span>,
          // Bold text
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          // Italic text
          em: ({ children }) => <em className="italic">{children}</em>,
          // Links - break anywhere for long URLs
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline break-all"
              style={{ color: '#BEE8FC' }}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}

/**
 * Helper to wrap selected text with markdown syntax
 * Used for Ctrl+B (bold) and Ctrl+I (italic) shortcuts
 */
export function wrapSelectionWithMarkdown(
  input: HTMLInputElement | HTMLTextAreaElement,
  wrapper: string,
  setValue: (value: string) => void
): void {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const text = input.value;
  const selectedText = text.slice(start, end);

  // If text is already wrapped, unwrap it
  const wrappedStart = start - wrapper.length;
  const wrappedEnd = end + wrapper.length;
  const beforeSelection = text.slice(Math.max(0, wrappedStart), start);
  const afterSelection = text.slice(end, Math.min(text.length, wrappedEnd));

  if (beforeSelection === wrapper && afterSelection === wrapper) {
    // Unwrap: remove the wrapper characters
    const newValue = text.slice(0, wrappedStart) + selectedText + text.slice(wrappedEnd);
    setValue(newValue);
    // Restore selection after state update
    requestAnimationFrame(() => {
      input.setSelectionRange(wrappedStart, wrappedStart + selectedText.length);
    });
  } else {
    // Wrap: add wrapper characters around selection
    const newValue = text.slice(0, start) + wrapper + selectedText + wrapper + text.slice(end);
    setValue(newValue);
    // Move cursor to after the wrapped text
    requestAnimationFrame(() => {
      const newStart = start + wrapper.length;
      const newEnd = end + wrapper.length;
      input.setSelectionRange(newStart, newEnd);
    });
  }
}

/**
 * Keyboard event handler for markdown shortcuts
 * Ctrl/Cmd + B = Bold (**text**)
 * Ctrl/Cmd + I = Italic (*text*)
 */
export function handleMarkdownKeyDown(
  e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  setValue: (value: string) => void
): void {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const modifier = isMac ? e.metaKey : e.ctrlKey;

  if (modifier && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    wrapSelectionWithMarkdown(e.currentTarget, '**', setValue);
  } else if (modifier && (e.key === 'i' || e.key === 'I')) {
    e.preventDefault();
    wrapSelectionWithMarkdown(e.currentTarget, '*', setValue);
  }
}
