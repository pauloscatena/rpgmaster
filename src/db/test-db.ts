import fs from 'node:fs';
import path from 'node:path';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb();
  const schema = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf-8');
  db.public.none(schema);
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}
