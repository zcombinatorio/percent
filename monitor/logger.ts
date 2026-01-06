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

import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export const LOG_FILES = ['lifecycle', 'server', 'twap'] as const;
export type LogFile = (typeof LOG_FILES)[number];

/**
 * Append a JSON error entry to the specified log file.
 */
export function logError(file: LogFile, data: Record<string, any>) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...data,
  };

  const filePath = path.join(LOGS_DIR, `${file}.jsonl`);
  const line = JSON.stringify(entry, null, 2) + '\n';
  fs.appendFileSync(filePath, line);
}

/**
 * Read all entries from a log file.
 */
export function readErrors(file: LogFile): Record<string, any>[] {
  const filePath = path.join(LOGS_DIR, `${file}.jsonl`);

  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: Record<string, any>[] = [];

  // Parse JSONL (each entry may be multi-line due to pretty printing)
  let buffer = '';
  let braceCount = 0;

  for (const char of content) {
    buffer += char;
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;

    if (braceCount === 0 && buffer.trim()) {
      try {
        entries.push(JSON.parse(buffer.trim()));
      } catch {
        // Skip malformed entries
      }
      buffer = '';
    }
  }

  return entries;
}

/**
 * Clear a log file.
 */
export function clearErrors(file: LogFile) {
  const filePath = path.join(LOGS_DIR, `${file}.jsonl`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Get path to logs directory.
 */
export function getLogsDir() {
  return LOGS_DIR;
}
