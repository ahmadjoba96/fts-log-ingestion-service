import { Pool } from 'pg';

export const writePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
});

export const readPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
});

writePool.on('error', (err) => {
  console.error('Unexpected error on idle write pool client:', err);
});

readPool.on('error', (err) => {
  console.error('Unexpected error on idle read pool client:', err);
});