import fs from 'node:fs';
import path from 'node:path';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const schema = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.public.none(schema);
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}
