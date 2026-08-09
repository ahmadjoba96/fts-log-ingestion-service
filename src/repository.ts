import { pool } from './db.js';
import type { LogEntryInput } from './validation.js';

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

  await pool.query(query, values);
}