import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { initSchema } from './schema';

let _db: Database.Database | null = null;

export function getDatabasePath(): string {
  let userDataDir: string;
  
  // Try to use Electron app path if available (for main process)
  try {
    const electron = require('electron');
    const app = electron.app || electron.remote?.app;
    if (app) {
      userDataDir = path.join(app.getPath('userData'), 'data');
    } else {
      userDataDir = process.env.UNISEARCH_USER_DATA_DIR || path.resolve(process.cwd(), 'data');
    }
  } catch {
    userDataDir = process.env.UNISEARCH_USER_DATA_DIR || path.resolve(process.cwd(), 'data');
  }

  // Ensure directory exists
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  return path.join(userDataDir, 'analytics.sqlite3');
}

export function getDb(): Database.Database {
  if (_db) {
    return _db;
  }

  const dbPath = getDatabasePath();
  const db = new Database(dbPath, { timeout: 30000 });
  
  // Performance optimizations
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize tables
  initSchema(db);

  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
