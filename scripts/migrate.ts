import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/pool';
import { loadConfig } from '../src/config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_init.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migração aplicada com sucesso.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
