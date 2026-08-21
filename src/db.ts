import { Pool } from 'pg';

export const writePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
});

export const readPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});