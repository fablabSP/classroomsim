// Entry point for the real app (Firebase Hosting or GitHub Pages).
import { startApp } from './app.js';
import { FirebaseStore } from './store-firebase.js';

const cfg = window.CLASSROOMSIM_CONFIG || {};
startApp({
  publicUrl: cfg.publicUrl || '',
  makeStore: async () => {
    const fb = cfg.firebase || {};
    if (!fb.apiKey || String(fb.apiKey).startsWith('PASTE')) throw new Error('Firebase is not set up for this copy of ClassroomSim yet.');
    return new FirebaseStore(fb);
  }
});
