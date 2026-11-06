// Entry point for the real app (GitHub Pages + Firebase).
import { startApp } from './app.js';
import { FirebaseStore } from './store-firebase.js';

const KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
const isExample = c => !c || !c.apiKey || /^PASTE/i.test(c.apiKey) || !c.projectId || /^your-project/i.test(c.projectId);
const setupError = (message, help, code) => Object.assign(new Error(message), { help, code });

// Find the Firebase settings however they were pasted into config.js:
// in our template, as the console's `const firebaseConfig = {...}`, or with the console's import lines left in.
async function readConfig() {
  const w = window.CLASSROOMSIM_CONFIG;
  if (!isExample(w?.firebase)) return w.firebase;
  // eslint-disable-next-line no-undef
  if (typeof firebaseConfig !== 'undefined' && !isExample(firebaseConfig)) return firebaseConfig;
  let text = '';
  try { const r = await fetch('config.js?fresh=' + Date.now(), { cache: 'no-store' }); if (r.ok) text = await r.text(); } catch {}
  const found = {};
  // Take every value written for each setting and prefer a real one over the example placeholders.
  const placeholder = v => /PASTE|your-project|^0+$|^1:0+:/i.test(v);
  for (const k of KEYS) {
    const all = [...text.matchAll(new RegExp(`["']?${k}["']?\\s*:\\s*["'\`]([^"'\`]+)["'\`]`, 'g'))].map(m => m[1].trim());
    if (all.length) found[k] = all.find(v => !placeholder(v)) || all[0];
  }
  if (!isExample(found)) return found;
  if (!text) throw setupError('ClassroomSim could not load public/config.js.', 'Check that config.js is inside the public folder of your GitHub repository, and that the latest run in the Actions tab finished with a green tick.', 'config-missing');
  if (found.apiKey || found.projectId) throw setupError('public/config.js still has the example values, not your Firebase settings.', 'On GitHub, open public/config.js, click the pencil, and replace the example values with the ones from Firebase (Project settings → Your apps → Web app → firebaseConfig). Commit, wait for the green tick in the Actions tab, then tap Try again.', 'config-example');
  throw setupError('public/config.js is there, but no Firebase settings were found in it.', 'Paste the firebaseConfig block from Firebase (Project settings → Your apps → Web app) into public/config.js. It must include apiKey, authDomain, projectId and appId.', 'config-empty');
}

function explain(e, projectId) {
  const code = e?.code || '';
  const where = projectId ? ` (project “${projectId}”)` : '';
  if (code === 'auth/configuration-not-found') return setupError(`Firebase Authentication hasn't been started yet${where}.`, 'In the Firebase console: Build → Authentication → Get started. Then Sign-in method → Anonymous → Enable → Save. Tap Try again.', code);
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return setupError(`Anonymous sign-in is turned off${where}.`, 'In the Firebase console: Build → Authentication → Sign-in method → Anonymous → Enable → Save. Then tap Try again.', code);
  if (/api-key/.test(code)) return setupError('Firebase did not accept the apiKey in public/config.js.', 'Copy the apiKey again from Firebase → Project settings → Your apps → Web app. It starts with “AIza”. Check there are no extra spaces or missing characters.', code);
  if (code === 'auth/unauthorized-domain') return setupError(`This web address isn't allowed in Firebase${where}.`, `In the Firebase console: Authentication → Settings → Authorized domains → Add domain → ${location.hostname}`, code);
  if (code === 'auth/network-request-failed') return setupError('No connection to Firebase.', 'Check the internet connection (some school networks block Firebase), then tap Try again.', code);
  return setupError(`Could not sign in to Firebase${where}.`, `Error: ${code || e?.message || e}. Check the Firebase settings in public/config.js and that Anonymous sign-in is enabled.`, code);
}

const cfg = window.CLASSROOMSIM_CONFIG || {};
startApp({
  publicUrl: cfg.publicUrl || '',
  makeStore: async () => {
    const fb = await readConfig();
    const store = new FirebaseStore(fb);
    try { await store.init(); } catch (e) { console.error(e); throw explain(e, fb.projectId); }
    store.projectId = fb.projectId;
    return store;
  }
});
