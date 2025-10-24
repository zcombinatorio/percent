import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { ILoggerService } from '../types/logger.interface';

/**
 * Service for structured logging with category-based file separation
 * Provides hierarchical logging with child loggers for sub-components
 */
export class LoggerService implements ILoggerService {
  private logger: winston.Logger;
  private category: string;
  private static instances: Map<string, LoggerService> = new Map();

  constructor(category: string) {
    this.category = category;
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Configure transports
    const transports: winston.transport[] = [];

    // Console transport (only in development)
    if (process.env.LOG_TO_CONSOLE !== 'false') {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
              return `[${this.category}] ${level}: ${message}${metaStr}`;
            })
          )
        })
      );
    }

    // File transport - one file per root category (before first dot)
    if (process.env.LOG_TO_FILE !== 'false') {
      // Extract root category (everything before first dot)
      const rootCategory = this.category.split('.')[0];
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, `${rootCategory}.log`),
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );

      // Error log file (all errors go here regardless of category)
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'errors.log'),
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );
    }

    // Create logger instance
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      defaultMeta: { category: this.category },
      transports,
      exitOnError: false
    });
  }

  /**
   * Get or create a logger instance for a specific category
   * Uses singleton pattern to reuse logger instances
   * @param category - Logger category name
   * @returns Logger service instance for the category
   */
  static getInstance(category: string): LoggerService {
    if (!this.instances.has(category)) {
      this.instances.set(category, new LoggerService(category));
    }
    return this.instances.get(category)!;
  }

  /**
   * Create a child logger with extended category
   * Useful for sub-components within the same category
   * Example: moderatorLogger.createChild('proposal') -> [moderator.proposal]
   * @param subCategory - Sub-category to append with dot notation
   * @returns New logger instance with extended category
   */
  createChild(subCategory: string): LoggerService {
    const child = Object.create(this);
    // Extend the category with dot notation
    child.category = `${this.category}.${subCategory}`;
    return child;
  }

  /**
   * Log an error message with optional metadata
   * @param message - Error message to log
   * @param meta - Optional metadata object (will be sanitized)
   */
  error(message: string, meta?: any): void {
    this.logger.error(message, this.sanitizeMeta(meta));
  }

  /**
   * Log a warning message with optional metadata
   * @param message - Warning message to log
   * @param meta - Optional metadata object (will be sanitized)
   */
  warn(message: string, meta?: any): void {
    this.logger.warn(message, this.sanitizeMeta(meta));
  }

  /**
   * Log an info message with optional metadata
   * @param message - Info message to log
   * @param meta - Optional metadata object (will be sanitized)
   */
  info(message: string, meta?: any): void {
    this.logger.info(message, this.sanitizeMeta(meta));
  }

  /**
   * Log a debug message with optional metadata
   * @param message - Debug message to log
   * @param meta - Optional metadata object (will be sanitized)
   */
  debug(message: string, meta?: any): void {
    this.logger.debug(message, this.sanitizeMeta(meta));
  }

  /**
   * Sanitize metadata to ensure all values are serializable
   * Handles special cases like Error objects, Solana PublicKeys, and BigNumbers
   * @param meta - Raw metadata object
   * @returns Sanitized metadata safe for JSON serialization
   */
  private sanitizeMeta(meta?: any): any {
    if (!meta) return {};

    const sanitized: any = {};

    for (const [key, value] of Object.entries(meta)) {
      // Skip null/undefined values
      if (value === null || value === undefined) continue;

      // Handle Error objects first
      if (value instanceof Error) {
        sanitized[key] = {
          message: value.message,
          stack: value.stack
        };
      }
      // Handle PublicKey objects (Solana addresses)
      else if (value && typeof value === 'object' && 'toBase58' in value) {
        sanitized[key] = (value as any).toBase58();
      }
      // Convert BigNumber/BN to string
      else if (value && typeof value === 'object' && 'toString' in value && !Array.isArray(value)) {
        sanitized[key] = value.toString();
      }
      // Prettify objects and arrays
      else if (typeof value === 'object' && typeof value !== 'function') {
        // For complex objects/arrays, stringify with pretty formatting
        sanitized[key] = JSON.stringify(value, null, 2);
      }
      // Pass through primitive values
      else if (typeof value !== 'function') {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}