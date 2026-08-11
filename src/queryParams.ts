export interface LogQueryParams {
  service?: string;
  level?: string;
  since?: string;
  until?: string;
  attrs: Record<string, string>;
  q?: string; // substring search on the log message
  limit: number;
  cursor?: string; // opaque
}

export interface ParamValidationResult {
  valid: boolean;
  reason?: string;
  params?: LogQueryParams;
}

export interface AggregateQueryParams {
  service?: string;
  level?: string;
  attrs: Record<string, string>;
  q?: string;
  since: string;
  until: string;
  bucket: string;
  groupBy: 'service' | 'level' | null;
}

const VALID_LEVELS = ['debug', 'info', 'warn', 'error'];
const VALID_BUCKETS = ['1m', '5m', '1h', '1d'];

export function parseLogQueryParams(query: Record<string, unknown>): ParamValidationResult {
  const service = typeof query.service === 'string' ? query.service : undefined;

  const level = typeof query.level === 'string' ? query.level : undefined;
  if (level !== undefined && !VALID_LEVELS.includes(level)) {
    return { valid: false, reason: `unsupported log level: '${level}'` };
  }

  let since: string | undefined;
  if (typeof query.since === 'string') {
    if (isNaN(new Date(query.since).getTime())) {
      return { valid: false, reason: 'invalid "since" timestamp' };
    }
    since = query.since;
  }

  let until: string | undefined;
  if (typeof query.until === 'string') {
    if (isNaN(new Date(query.until).getTime())) {
      return { valid: false, reason: 'invalid "until" timestamp' };
    }
    until = query.until;
  }

  if (since && until && new Date(until) < new Date(since)) {
    return { valid: false, reason: '"until" must not be earlier than "since"' };
  }

  const q = typeof query.q === 'string' ? query.q : undefined;

  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('attr.') && typeof value === 'string') {
      attrs[key.slice('attr.'.length)] = value;
    }
  }

  let limit = 100;
  if (typeof query.limit === 'string') {
    const parsedLimit = Number(query.limit);
    if (!Number.isInteger(parsedLimit) || String(parsedLimit) !== query.limit) {
      return { valid: false, reason: 'limit must be a valid integer' };
    }
    if (parsedLimit < 1 || parsedLimit > 1000) {
      return { valid: false, reason: 'limit must be between 1 and 1000' };
    }
    limit = parsedLimit;
  }

  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;

  return {
    valid: true,
    params: { service, level, since, until, attrs, q, limit, cursor },
  };
}

export function parseAggregateQueryParams(
  query: Record<string, unknown>,
): { valid: boolean; reason?: string; params?: AggregateQueryParams } {
  if (typeof query.since !== 'string' || isNaN(new Date(query.since).getTime())) {
    return { valid: false, reason: '"since" is required and must be a valid timestamp' };
  }
  if (typeof query.until !== 'string' || isNaN(new Date(query.until).getTime())) {
    return { valid: false, reason: '"until" is required and must be a valid timestamp' };
  }
  if (new Date(query.until) < new Date(query.since)) {
    return { valid: false, reason: '"until" must not be earlier than "since"' };
  }
  if (typeof query.bucket !== 'string' || !VALID_BUCKETS.includes(query.bucket)) {
    return { valid: false, reason: 'bucket must be one of: 1m, 5m, 1h, 1d' };
  }
  let groupBy: 'service' | 'level' | null = null;
  if (query.group_by !== undefined) {
    if (query.group_by !== 'service' && query.group_by !== 'level') {
      return { valid: false, reason: 'group_by must be "service" or "level"' };
    }
    groupBy = query.group_by;
  }
  const service = typeof query.service === 'string' ? query.service : undefined;
  const level = typeof query.level === 'string' ? query.level : undefined;
  if (level !== undefined && !['debug', 'info', 'warn', 'error'].includes(level)) {
    return { valid: false, reason: `unsupported log level: '${level}'` };
  }
  const q = typeof query.q === 'string' ? query.q : undefined;
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('attr.') && typeof value === 'string') {
      attrs[key.slice(5)] = value;
    }
  }

  return {
    valid: true,
    params: { service, level, attrs, q, since: query.since, until: query.until, bucket: query.bucket, groupBy },
  };
}
