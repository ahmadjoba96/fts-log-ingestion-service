export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntryInput {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function validateLogEntry(entry: unknown): ValidationResult {
  if (typeof entry !== 'object' || entry === null) {
    return { valid: false, reason: 'entry must be an object' };
  }

  const e = entry as Record<string, unknown>;

  // Validate timestamp
  if (typeof e.timestamp !== 'string') {
    return { valid: false, reason: 'timestamp is required' };
  }
  const parsedDate = new Date(e.timestamp);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, reason: 'timestamp must be a valid ISO 8601 timestamp' };
  }
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (parsedDate > fiveMinutesFromNow) {
    return { valid: false, reason: 'timestamp must not be more than five minutes in the future' };
  }

  // Validate level
  if (typeof e.level !== 'string' || !VALID_LEVELS.includes(e.level as LogLevel)) {
    return { valid: false, reason: `invalid level: '${String(e.level)}'` };
  }

  // Validate service
  if (typeof e.service !== 'string' || e.service.trim() === '') {
    return { valid: false, reason: 'service must be a non-empty string' };
  }

  // Validate message
  if (typeof e.message !== 'string' || e.message.trim() === '') {
    return { valid: false, reason: 'message must be a non-empty string' };
  }

  // Validate attributes (optional)
  if (e.attributes !== undefined) {
    if (typeof e.attributes !== 'object' || e.attributes === null || Array.isArray(e.attributes)) {
      return { valid: false, reason: 'attributes must be a flat object' };
    }
    for (const [key, value] of Object.entries(e.attributes)) {
      const type = typeof value;
      if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        return { valid: false, reason: `attribute '${key}' must be a string, number, or boolean` };
      }
    }
  }

  return { valid: true };
}