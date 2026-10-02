import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'accounting.sqlite'),
  uploadsDir: path.join(dataDir, 'uploads'),
  // Behind HTTPS (production) the session cookie must be Secure.
  cookieSecure: process.env.COOKIE_SECURE === '1',
  sessionDays: 14,
  maxUploadBytes: 20 * 1024 * 1024,
  maxFilesPerUpload: 30,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  extractionModel: process.env.EXTRACTION_MODEL || 'claude-opus-5-5',
  extractionEffort: process.env.EXTRACTION_EFFORT || 'low',
  workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS || 2000),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 3),
  // Set to 0 in tests: the server then never reads documents on its own.
  workerEnabled: process.env.WORKER_ENABLED !== '0',
};
