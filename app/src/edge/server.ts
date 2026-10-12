import { join } from 'node:path';
import { createEdge } from './proxy.ts';
import { StateReader, socketFd, stateRoot } from './state.ts';

const fd = socketFd(process.env, process.pid);
const root = stateRoot();
const state = new StateReader(join(root, 'active.json'));
await state.get(); // Do not accept traffic without a validated operator target.
const server = createEdge({ state, assets: join(root, 'static') });
server.listen({ fd });
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 30_000).unref();
    server.close(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  });
