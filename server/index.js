import { Store } from './store.js';
import { createApp } from './app.js';
const store = new Store();
const port = Number(process.env.PORT || 8000);
const server = createApp(store).listen(port, '127.0.0.1', () =>
  console.log(
    `Homeward app/API: http://localhost:${port}\nTrueForge MCP URL: http://localhost:${port}/mcp (No auth, local synthetic data only)`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
