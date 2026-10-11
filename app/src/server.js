import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config, { logger: { level: config.logLevel } });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    await app.close();
    clearTimeout(deadline);
  });
}
await app.listen({ host: config.host, port: config.port });
