import { createApp } from './app.js';
import { pool } from './db.js';
import { config } from './config.js';

await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
const instance = createApp();
const server = instance.app.listen(config.port, () => console.log(`Место: ${config.origin}`));
const stop = () => {
  server.close(async () => { instance.close(); await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
