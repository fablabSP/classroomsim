// Entry point for one screen inside the demo page. All screens share the parent's in-memory database.
import { startApp } from './app.js';
import { MemoryStore, BridgeHub } from './store-memory.js';

startApp({
  publicUrl: 'https://your-project.web.app/',
  makeStore: async () => new MemoryStore(new BridgeHub(window.parent), window.DEMO_UID)
});
