import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './data/messages.db';
const BACKUP_DIR = process.env.BACKUP_DIR ?? './data/backups';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(BACKUP_DIR, `messages-${timestamp}.db`);

mkdirSync(BACKUP_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('wal_checkpoint(TRUNCATE)');
sqlite.close();

copyFileSync(DB_PATH, backupPath);

console.log(`Backup creado en ${backupPath}`);
