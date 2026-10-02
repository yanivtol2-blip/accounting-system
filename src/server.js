import { createApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { startWorker } from './worker.js';

const db = openDb();
const app = createApp(db);

if (config.workerEnabled) startWorker(db);
if (!config.anthropicApiKey) {
  console.warn('ANTHROPIC_API_KEY is not set: uploaded documents go to the queue without automatic reading.');
}

app.listen(config.port, () => {
  console.log(`accounting system listening on http://localhost:${config.port}`);
});
