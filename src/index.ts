import 'dotenv/config';
import express from 'express';
import { readPool } from './db.js';
import { validateLogEntry, type LogEntryInput } from './validation.js';
import { insertLogs } from './repository.js';
import { parseLogQueryParams } from './queryParams.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { queryLogs } from './repository.js';
import { parseAggregateQueryParams } from './queryParams.js';
import { aggregateLogs } from './repository.js';
import { startRetentionJob } from './retention.js';

const app = express();
const port = 8080;

app.use(express.json({ limit: '10mb' }));

app.get('/health', async (req, res) => {
  try {
    await readPool.query('SELECT 1');
    res.status(200).send('OK');
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).send('Database not ready');
  }
});

app.post('/logs', async (req, res) => {
  const body = req.body;

  if (!body || !Array.isArray(body.logs)) {
    return res.status(400).json({ error: 'request body must have a "logs" array' });
  }

  const accepted: LogEntryInput[] = [];
  const rejected: { index: number; reason: string }[] = [];

  body.logs.forEach((entry: unknown, index: number) => {
    const result = validateLogEntry(entry);
    if (result.valid) {
      accepted.push(entry as LogEntryInput);
    } else {
      rejected.push({ index, reason: result.reason! });
    }
  });

  if (accepted.length === 0) {
    return res.status(400).json({ accepted: 0, rejected });
  }

  await insertLogs(accepted);

  res.status(200).json({ accepted: accepted.length, rejected });
});

app.get('/logs', async (req, res) => {
  const result = parseLogQueryParams(req.query as Record<string, unknown>);

  if (!result.valid || !result.params) {
    return res.status(400).json({ error: result.reason });
  }

  const params = result.params;

  let cursor = null;
  if (params.cursor) {
    cursor = decodeCursor(params.cursor);
    if (!cursor) {
      return res.status(400).json({ error: 'invalid or malformed cursor' });
    }
  }

  const rows = await queryLogs(params, cursor);

  // We fetch one extra row to know if there a next page
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;

  const logs = pageRows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: row.attributes ?? {},
  }));

  let next_cursor: string | null = null;
  if (hasMore) {
    const last = pageRows[pageRows.length - 1];
    next_cursor = encodeCursor({ timestamp: last.timestamp, id: Number(last.id) });
  }

  res.status(200).json({ logs, next_cursor });
});

app.get('/logs/aggregate', async (req, res) => {
  const result = parseAggregateQueryParams(req.query as Record<string, unknown>);
  if (!result.valid || !result.params) {
    return res.status(400).json({ error: result.reason });
  }
  const p = result.params;
  const rows = await aggregateLogs(p, p.since, p.until, p.bucket, p.groupBy);
  const buckets = rows.map((r) => ({
    start: r.start,
    group: r.group,
    count: Number(r.count),
  }));
  res.status(200).json({ buckets });
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'malformed JSON in request body' });
  }
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'internal server error' });
});

app.listen(port, () => {
  console.log(`Server is running on Port:${port}`);
});

startRetentionJob();
