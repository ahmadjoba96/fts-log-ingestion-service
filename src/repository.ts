import { writePool, readPool } from './db.js';
import type { LogEntryInput } from './validation.js';
import type { LogQueryParams } from './queryParams.js';
import type { Cursor } from './cursor.js';

export interface LogRow {
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, unknown> | null;
}

export interface BucketRow {
  start: string;
  group: string | null;
  count: string;
}

const BUCKET_EXPR: Record<string, string> = {
  '1m': "date_trunc('minute', timestamp)",
  '1h': "date_trunc('hour', timestamp)",
  '1d': "date_trunc('day', timestamp)",
  '5m': 'to_timestamp(floor(extract(epoch from timestamp) / 300) * 300)',
};

export async function insertLogs(entries: LogEntryInput[]): Promise<void> {
  if (entries.length === 0) return;

  const columns = ['timestamp', 'level', 'service', 'message', 'attributes'];
  const values: unknown[] = [];
  const rows: string[] = [];

  entries.forEach((entry, i) => {
    const offset = i * columns.length;
    const placeholders = columns.map((_, j) => `$${offset + j + 1}`);
    rows.push(`(${placeholders.join(', ')})`);
    values.push(
      entry.timestamp,
      entry.level,
      entry.service,
      entry.message,
      entry.attributes ? JSON.stringify(entry.attributes) : null,
    );
  });

  const query = `
    INSERT INTO logs (${columns.join(', ')})
    VALUES ${rows.join(', ')}
  `;

  await writePool.query(query, values);
}

export async function queryLogs(params: LogQueryParams, cursor: Cursor | null): Promise<LogRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addCondition(sql: string, value: unknown): void {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  }

  if (params.service) {
    addCondition('service = ?', params.service);
  }
  if (params.level) {
    addCondition('level = ?', params.level);
  }
  if (params.since) {
    addCondition('timestamp >= ?', params.since);
  }
  if (params.until) {
    addCondition('timestamp < ?', params.until);
  }
  if (params.q) {
    addCondition('message ILIKE ?', `%${params.q}%`);
  }
  for (const [key, value] of Object.entries(params.attrs)) {
    addCondition(`attributes ->> '${key}' = ?`, value);
  }
  if (cursor) {
    values.push(cursor.timestamp, cursor.id);
    conditions.push(`(timestamp, id) < ($${values.length - 1}, $${values.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${values.length + 1}
  `;
  values.push(params.limit + 1); // fetch one extra row

  const result = await readPool.query(query, values);
  return result.rows;
}

export async function aggregateLogs(
  params: { service?: string; level?: string; attrs: Record<string, string>; q?: string },
  since: string,
  until: string,
  bucket: string,
  groupBy: 'service' | 'level' | null,
): Promise<BucketRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addCondition(sql: string, value: unknown): void {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  }

  addCondition('timestamp >= ?', since);
  addCondition('timestamp < ?', until);
  if (params.service) addCondition('service = ?', params.service);
  if (params.level) addCondition('level = ?', params.level);
  if (params.q) addCondition('message ILIKE ?', `%${params.q}%`);
  for (const [key, value] of Object.entries(params.attrs)) {
    addCondition(`attributes ->> '${key}' = ?`, value);
  }

  const bucketExpr = BUCKET_EXPR[bucket];
  const groupExpr = groupBy ? groupBy : 'NULL';

  const query = `
    SELECT ${bucketExpr} AS start, ${groupExpr} AS "group", COUNT(*) AS count
    FROM logs
    WHERE ${conditions.join(' AND ')}
    GROUP BY start, ${groupExpr}
    ORDER BY start ASC
  `;

  const result = await readPool.query(query, values);
  return result.rows;
}

export async function deleteExpiredLogs(retentionDays: number, batchSize: number): Promise<number> {
  const result = await writePool.query(
    `
    DELETE FROM logs
    WHERE id IN (
      SELECT id FROM logs
      WHERE timestamp < NOW() - ($1 || ' days')::interval
      LIMIT $2
    )
    `,
    [retentionDays, batchSize],
  );
  return result.rowCount ?? 0;
}
