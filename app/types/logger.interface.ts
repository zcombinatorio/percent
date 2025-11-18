/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

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