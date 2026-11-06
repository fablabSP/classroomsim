// Runs the demo page: one in-memory database (with the same access rules as Firestore),
// three app screens in iframes, and a few presenter controls.
import { MemoryHub, MemoryStore, serveHub } from './store-memory.js';
import * as E from './engine.js';

const APP_CSS = window.__DEMO.css, APP_JS = window.__DEMO.js, FAVICON = window.__DEMO.favicon;
const NAMES = ['Aisha Rahman', 'Ben Tan', 'Chloe Lim', 'Daniel Ong', 'Esther Goh', 'Farid Ali', 'Grace Wong', 'Hari Kumar'];
const ROLE_WORD = { red: 'Red · disengaged', green: 'Green · engaged', yellow: 'Yellow · over-keen', blue: 'Blue · struggling', black: 'Black · disruptive', normal: 'Regular learner' };
const $ = id => document.getElementById(id);

let hub, host, code, people = [], currentP = null, seenInc = new Set(), pickerSig = '', unsub = null, state = null;
const frames = { ins: $('f-ins'), ev: $('f-ev'), p: $('f-p') };
const devices = { ins: $('d-ins'), ev: $('d-ev'), p: $('d-p') };

const routerReady = (() => { let ready = false; return () => { if (ready) return; ready = true; serveHub({ read: (...a) => hub.read(...a), list: (...a) => hub.list(...a), commit: (...a) => hub.commit(...a), subscribe: (...a) => hub.subscribe(...a) }); }; })();

function mount(key, uid, identity, openQr = false) {
  const store = { cs_identity: JSON.stringify(identity), cs_prefs: JSON.stringify({ vibrate: true, sound: true, wake: false, text: 0 }) };
  const shim = `window.DEMO_UID=${JSON.stringify(uid)};window.__OPEN_QR=${openQr};window.__FAVICON=${JSON.stringify(FAVICON)};
    (function(){var s=${JSON.stringify(store).replace(/</g, '\\u003c')};window.__LS={getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null},setItem:function(k,v){s[k]=String(v)},removeItem:function(k){delete s[k]}};
    try{Object.defineProperty(navigator,'vibrate',{configurable:true,value:function(p){parent.postMessage({t:'cs-buzz',frame:${JSON.stringify(key)},pattern:p},'*');return true;}});}catch(e){}
    window.print=function(){};})();`;
  const S = x => '<scr' + 'ipt>' + x + '</scr' + 'ipt>';
  frames[key].srcdoc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..900&family=Atkinson+Hyperlegible:wght@400;700&display=swap">'
    + '<style>' + APP_CSS + '</style></head><body><div id="app"></div><div id="toast" class="toast" role="status" aria-live="polite"></div><div id="flash" class="flash"></div><div id="modal-root"></div><div id="print-area"></div>'
    + S(shim) + S(APP_JS) + '</body></html>';
}
window.addEventListener('message', e => {
  const d = e.data; if (!d || d.t !== 'cs-buzz') return;
  const total = Array.isArray(d.pattern) ? d.pattern.reduce((a, b) => a + b, 0) : Number(d.pattern) || 0;
  if (total >= 100) buzz(d.frame);
});
function buzz(key) {
  const dev = devices[key]; if (!dev) return;
  dev.classList.remove('buzzing'); void dev.offsetWidth; dev.classList.add('buzzing');
  clearTimeout(dev._t); dev._t = setTimeout(() => dev.classList.remove('buzzing'), 1600);
  if (document.body.dataset.view !== key) document.querySelector(`.tabs [data-v="${key}"]`)?.classList.add('ping');
}

function showParticipant(uid, alertIt) {
  const p = people.find(x => x.uid === uid) || people[2];
  currentP = p.uid;
  mount('p', p.uid, { code, kind: 'participant' });
  $('pick').value = p.uid;
  if (alertIt) setTimeout(() => buzz('p'), 400);
}
function onState(d) {
  if (!d) return;
  state = JSON.parse(d.data);
  const r = state.round;
  const label = p => p.name + (r.assignedAt && p.uid === r.leadId ? ' · Lead Trainer' : r.assignedAt && p.uid === r.supportId ? ' · Support Trainer' : r.roles[p.uid] ? ' · ' + ROLE_WORD[r.roles[p.uid]] : '');
  const sig = people.map(label).join('|');
  if (sig !== pickerSig) { pickerSig = sig; $('pick').innerHTML = people.map(p => `<option value="${p.uid}">${label(p).replace(/</g, '&lt;')}</option>`).join(''); $('pick').value = currentP; }
  for (const inc of r.incidents) {
    if (inc.status !== 'active' || seenInc.has(inc.id)) continue;
    seenInc.add(inc.id);
    if ($('follow').checked && inc.participantId !== currentP) showParticipant(inc.participantId, true);
  }
}

async function seed() {
  unsub?.(); host?.stop();
  hub = new MemoryHub({ rules: true }); routerReady();
  seenInc = new Set(); pickerSig = ''; state = null;
  const owner = new MemoryStore(hub, 'u-louis');
  code = await E.createSession(owner, { instructorName: 'Louis', cohort: 'CET Cohort 07', lessonTopic: 'Prompting an AI chatbot', durationMinutes: 10, mode: 'practice' });
  people = [];
  for (const name of NAMES) {
    const uid = 'u-' + name.split(' ')[0].toLowerCase();
    await E.joinParticipant(new MemoryStore(hub, uid), code, name);
    people.push({ uid, name });
  }
  const pin = hub.read('u-louis', E.paths(code).pin).data.pin;
  await E.joinStaff(new MemoryStore(hub, 'u-koh'), code, 'Ms Koh', pin);
  host = new E.StaffSession(owner, code).start(); // a background staff device: lets people in, runs timers
  window.__demoHost = host; // used by automated tests
  unsub = hub.subscribe('u-louis', 'doc', E.paths(code).state, onState);
  $('m-code').textContent = code; $('m-pin').textContent = pin;
  mount('ins', 'u-louis', { code, kind: 'staff' }, true);
  mount('ev', 'u-koh', { code, kind: 'staff' });
  showParticipant('u-chloe', false);
}

function flashCtl(id, msg) { const b = $(id); const t = b.dataset.t || b.textContent; b.dataset.t = t; b.textContent = msg; clearTimeout(b._h); b._h = setTimeout(() => { b.textContent = t; }, 1800); }
$('b-reset').addEventListener('click', () => seed());
$('b-skip').addEventListener('click', async () => {
  if (state?.round.status !== 'running') return flashCtl('b-skip', 'Start a round first');
  await host.mutate(s => { if (s.round.status === 'running') s.round.startedAt -= 30000; return {}; });
  flashCtl('b-skip', 'Skipped 30 s');
});
$('b-quick').addEventListener('click', async () => {
  try {
    if (!state || state.participants.length < 4) return flashCtl('b-quick', 'People still joining…');
    const r = state.round;
    if (r.status !== 'lobby') return flashCtl('b-quick', 'Round already started');
    if (!r.leadId || !r.supportId) await host.command({ action: 'setTrainers', leadId: 'u-aisha', supportId: 'u-ben' });
    if (!host.state.round.assignedAt) await host.command({ action: 'assignRoles' });
    await host.command({ action: 'start' });
    mount('ins', 'u-louis', { code, kind: 'staff' });
    flashCtl('b-quick', 'Round started');
  } catch (e) { flashCtl('b-quick', e.message); }
});
$('pick').addEventListener('change', e => showParticipant(e.target.value, false));
document.body.dataset.view = 'ins';
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.body.dataset.view = b.dataset.v; b.classList.remove('ping');
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
}));
seed();
