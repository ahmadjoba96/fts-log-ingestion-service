import 'dotenv/config';
import express from 'express';
import { pool } from './db.js';

const app = express();
const port = 8080;

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).send('OK');
    } catch (err) {
        console.error('Database connection error:', err);
        res.status(500).send('Database connection error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on Port:${port}`);
});