import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/pool';
import { loadConfig } from '../src/config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const already = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [file]);
    if (already.rows.length > 0) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
    console.log(`Aplicada: ${file}`);
  }
  console.log('Migrações em dia.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
