/**
 * Interface for Logger Service
 * Provides structured logging with category-based file separation
 *
 * Implementation note: The constructor should accept:
 * - category: string - Logger category for this instance
 */
export interface ILoggerService {
  /**
   * Log an error message with optional metadata
   * @param message - Error message to log
   * @param meta - Optional metadata object
   */
  error(message: string, meta?: any): void;

  /**
   * Log a warning message with optional metadata
   * @param message - Warning message to log
   * @param meta - Optional metadata object
   */
  warn(message: string, meta?: any): void;

  /**
   * Log an info message with optional metadata
   * @param message - Info message to log
   * @param meta - Optional metadata object
   */
  info(message: string, meta?: any): void;

  /**
   * Log a debug message with optional metadata
   * @param message - Debug message to log
   * @param meta - Optional metadata object
   */
  debug(message: string, meta?: any): void;

  /**
   * Create a child logger with extended category
   * Useful for sub-components within the same category
   * @param subCategory - Sub-category to append to parent category
   * @returns New logger instance with extended category
   */
  createChild(subCategory: string): ILoggerService;
}