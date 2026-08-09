import 'dotenv/config';
import express from 'express';
import { pool } from './db.js';
import { validateLogEntry, type LogEntryInput } from './validation.js';
import { insertLogs } from './repository.js';

const app = express();
const port = 8080;

app.use(express.json());

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

app.listen(port, () => {
    console.log(`Server is running on Port:${port}`);
});