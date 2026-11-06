/* ClassroomSim 3 front end. Two interfaces: evaluators (run and assess) and participants (a hand of cards). */
import * as E from './engine.js';
import { svg as qrSvgOf } from './qr.js';

export function startApp({ makeStore, publicUrl }) {
const $ = sel => document.querySelector(sel);
const FAV = window.__FAVICON || 'favicon.svg';
const LS = () => window.__LS || window.localStorage; // the demo gives each screen its own storage
const app = $('#app'), toastEl = $('#toast'), modalRoot = $('#modal-root');

// ---------------- constants ----------------
const ROLE = {
  red:    { sym: '◔', name: 'Disengaged learner', desc: 'You lose interest or stop taking part.' },
  green:  { sym: '✓', name: 'Engaged learner', desc: 'You take part well and help others.' },
  yellow: { sym: '✋', name: 'Over-keen learner', desc: 'You are very eager and tend to take over.' },
  blue:   { sym: '?', name: 'Struggling learner', desc: 'You fall behind or misunderstand instructions.' },
  black:  { sym: '!', name: 'Disruptive learner', desc: 'You distract others or interrupt the lesson.' },
  normal: { sym: '◉', name: 'Regular learner', desc: 'Take part naturally all the way through.' }
};
const PHASES = { explanation: 'Explaining', discussion: 'Discussion', independent: 'Solo work', group: 'Group work', conclusion: 'Wrap-up' };
const AREA_SHORT = { 'Lesson facilitation': 'Facilitation', 'Classroom awareness': 'Awareness', 'Learner engagement': 'Engagement', 'Classroom management': 'Management', 'Differentiated support': 'Differentiation', 'Lead–Support coordination': 'Coordination', 'Support Trainer': 'Support Trainer', 'General': 'General' };
const SCORE_LABELS = [['not-observed', 'Not seen'], ['1', '1 Emerging'], ['2', '2 Developing'], ['3', '3 Competent'], ['4', '4 Proficient']];
const OUTCOMES = [['pending', 'Not decided'], ['competent', 'Competent'], ['not-yet-competent', 'Not yet competent']];
const RATE = {
  noticed:   { label: 'Noticed?', opts: [['quick', 'Quickly', 'good'], ['late', 'Late', 'warn'], ['missed', 'Missed', 'bad']] },
  response:  { label: 'Response', opts: [['effective', 'Good', 'good'], ['partial', 'Partly', 'warn'], ['ineffective', 'Poor', 'bad']] },
  handledBy: { label: 'Handled by', opts: [['lead', 'Lead', ''], ['support', 'Support', ''], ['both', 'Both', ''], ['none', 'No one', 'bad']] }
};
const RATE_WORDS = { quick: 'noticed quickly', late: 'noticed late', missed: 'not noticed', effective: 'handled effectively', partial: 'partly effective', ineffective: 'not effective', lead: 'by the Lead Trainer', support: 'by the Support Trainer', both: 'by both trainers', none: 'by no one' };

// ---------------- state ----------------
let store = null, sess = null;
let identity = load('cs_identity', null); // {code, kind: 'staff' | 'participant'}
let prefs = Object.assign({ vibrate: true, sound: true, wake: true, text: 0 }, load('cs_prefs', {}));
let S = null, receivedAt = 0, online = navigator.onLine !== false;
let view = null, landing = 'home', staffTab = 'new', evalTarget = 'lead', tagFilter = 'all', reviewIndex = null;
let archived = null, archivedLoading = false, openStep = null, lastLogged = null, qrOnOpen = !!window.__OPEN_QR, sendFilter = 'all';
const mySessions = () => load('cs_sessions', []);
function rememberSession(entry) { const list = mySessions().filter(x => x.code !== entry.code); const old = mySessions().find(x => x.code === entry.code) || {}; list.unshift({ ...old, ...entry, at: old.at || Date.now() }); save('cs_sessions', list.slice(0, 30)); }
function forgetSession(code) { save('cs_sessions', mySessions().filter(x => x.code !== code)); }
let pendingRender = false, alertsUnlocked = false, wakeLock = null, bootError = null;
let seenIncidents = new Set(), warnedTwoMin = {}, lastToastUndo = null, dealtKeys = new Set(), hadPerson = false;
document.documentElement.dataset.text = prefs.text;

function load(k, d) { try { const v = LS().getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { v == null ? LS().removeItem(k) : LS().setItem(k, JSON.stringify(v)); } catch {} }
const flipKey = () => `cs_flip_${identity?.code}`;
const flipped = () => new Set(load(flipKey(), []));
function setFlipped(id, on) { const f = flipped(); on ? f.add(id) : f.delete(id); save(flipKey(), [...f].slice(-80)); }
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = ms => { if (ms == null) return '–'; const n = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const clockOf = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isStaff = () => S && S.kind === 'staff';
const pname = id => S?.participants?.find(p => p.id === id)?.name || '—';
const roleBadge = c => `<span class="role ${esc(c)}">${esc(ROLE[c]?.sym || '')} ${esc(c === 'normal' ? 'Regular' : c[0].toUpperCase() + c.slice(1))}</span>`;
const chip = (t, cls = '') => `<span class="chip ${cls}">${esc(t)}</span>`;
function remainingNow() { if (!S) return 0; const r = S.round; return Math.max(0, r.remainingMs - (r.status === 'running' ? Date.now() - receivedAt : 0)); }
function elapsedNow() { if (!S) return 0; const r = S.round; return r.elapsedMs + (r.status === 'running' ? Date.now() - receivedAt : 0); }
const statusText = s => ({ lobby: 'Not started', running: 'Live', paused: 'Paused', ended: 'Finished' }[s] || s);
function baseUrl() { return publicUrl || (location.origin + location.pathname.replace(/index\.html$/, '')); }
function joinUrl(kind = 'join') { return `${baseUrl()}?${kind}=${S.code}`; }
function qrSvg() { try { return qrSvgOf(joinUrl()); } catch (e) { console.error('QR code could not be drawn:', e); return '<p class="small muted" style="padding:1rem">QR not available. Share the link instead.</p>'; } }

// ---------------- connecting ----------------
async function getStore() {
  if (store) return store;
  store = await makeStore();
  await store.init();
  return store;
}
function attach() {
  if (sess) sess.stop();
  S = null; archived = null; seenIncidents = new Set(); hadPerson = false;
  const onError = e => {
    console.error(e);
    if (e && (e.status === 404 || /no longer exists/i.test(e.message))) { toast(e.message, true); signOut(true); return; }
    if (e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''))) { toast('This device is no longer part of that session.', true); signOut(true); return; }
    setOnline(false);
  };
  if (identity.kind === 'staff') {
    sess = new E.StaffSession(store, identity.code, { onChange: v => { setOnline(true); const prev = S; S = v; if (!prev) rememberSession({ code: v.code, topic: v.lessonTopic, cohort: v.cohort }); if (!prev && qrOnOpen) { qrOnOpen = false; setTimeout(() => showQR(true), 50); } receivedAt = Date.now(); detectAlerts(prev, S); render(); }, onError }).start();
  } else {
    sess = new E.ParticipantSession(store, identity.code, { onView: onParticipantView, onError }).start();
  }
}
function onParticipantView(v, person, pub) {
  setOnline(true);
  if (person) hadPerson = true;
  if (!v && person === null && hadPerson) { toast('You were removed from the session.', true); signOut(true); return; }
  const prev = S;
  const blank = { status: 'lobby', elapsedMs: 0, remainingMs: 0, durationMinutes: 0, incidents: [] };
  if (!v) { S = { kind: 'participant', waiting: true, round: blank, me: { name: person?.name || '' }, code: identity.code, lessonTopic: pub?.lessonTopic }; render(); return; }
  if (v.pending) { S = { ...v, kind: 'participant', round: blank }; render(); return; }
  // The clock lives in the shared session doc; the cards live in this person's private doc.
  const clock = pub?.round || {}, now = Date.now();
  const r = { ...clock, ...v.round };
  const el = (clock.accumulatedMs || 0) + (clock.status === 'running' && clock.startedAt ? now - clock.startedAt : 0);
  S = { ...v, kind: 'participant', round: { ...r, elapsedMs: el, remainingMs: Math.max(0, (clock.durationMinutes || 0) * 60000 - el) } };
  receivedAt = now;
  detectAlerts(prev && !prev.waiting && !prev.pending ? prev : null, S);
  render();
}
window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));
function setOnline(v) { if (online === v) return; online = v; const d = $('#conn'); if (d) d.className = 'dot ' + (v ? 'on' : 'off'); if (!v) toast('Connection lost. It will catch up when you are back online.', true); }

async function cmd(action, values = {}, okMsg) {
  try { const r = await sess.command({ action, ...values }); if (okMsg) toast(okMsg); return r || {}; }
  catch (e) { toast(e.message || 'That did not work. Please try again.', true); return null; }
}
function signOut(silent) {
  sess?.stop(); sess = null;
  identity = null; S = null; archived = null; view = null; landing = 'home';
  save('cs_identity', null); releaseWake(); document.getElementById('table-felt')?.remove();
  if (!silent) toast('You have left the session on this device.');
  render(true);
}
function startSession(id) {
  identity = id; save('cs_identity', id);
  try { history.replaceState(null, '', location.pathname); } catch {}
  view = null; render(true); attach();
}

// ---------------- alerts ----------------
let audioCtx = null, iosSwitch = null;
const canVibrate = () => typeof navigator.vibrate === 'function';
function unlockAlerts() {
  alertsUnlocked = true;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); g.gain.value = 0.0001; o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.02);
  } catch {}
  requestWake();
}
function beep(kind) {
  if (!prefs.sound || !audioCtx) return;
  try {
    const notes = kind === 'scenario' ? [523, 659, 784, 1047] : kind === 'soft' ? [660] : [784, 1047];
    let t = audioCtx.currentTime + 0.01;
    for (const f of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.connect(g).connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.22); t += 0.13;
    }
  } catch {}
}
function iosHaptic(times) {
  try {
    if (!iosSwitch) {
      const label = document.createElement('label'); label.className = 'sr'; label.setAttribute('aria-hidden', 'true');
      const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      label.appendChild(input); document.body.appendChild(label); iosSwitch = label;
    }
    for (let i = 0; i < times; i++) setTimeout(() => iosSwitch.click(), i * 140);
  } catch {}
}
function buzz(kind) {
  if (!prefs.vibrate) return;
  const pattern = kind === 'scenario' ? [400, 150, 400, 150, 600] : kind === 'soft' ? [120] : [250, 120, 250];
  if (canVibrate()) { try { navigator.vibrate(pattern); } catch {} } else iosHaptic(kind === 'scenario' ? 4 : kind === 'soft' ? 1 : 2);
}
function flash() { const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
let titleTimer = null;
function titleAlert(msg) {
  clearInterval(titleTimer); let n = 0;
  titleTimer = setInterval(() => { document.title = n++ % 2 ? 'ClassroomSim' : '🔔 ' + msg; if (n > 12 || !document.hidden) { clearInterval(titleTimer); document.title = 'ClassroomSim'; } }, 900);
}
function notify(kind, msg) { buzz(kind); beep(kind); flash(); if (msg) { toast(msg); titleAlert(msg); } }
async function requestWake() {
  if (!prefs.wake || !('wakeLock' in navigator) || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch {}
}
function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && alertsUnlocked) requestWake(); });
function ratingDone(i) { return !!(i.rating && i.rating.noticed && i.rating.response && i.rating.handledBy); }

function detectAlerts(prev, next) {
  const r = next.round;
  if (!prev) { (r.incidents || []).forEach(i => seenIncidents.add(i.id)); return; }
  const pr = prev.round;
  if (next.kind === 'participant') {
    for (const inc of r.incidents) if (inc.status === 'active' && !seenIncidents.has(inc.id)) { seenIncidents.add(inc.id); notify('scenario'); }
    if (!pr.isAssigned && r.isAssigned) notify('role', next.me.type === 'student' ? 'Your role card has been dealt' : 'Your trainer card has been dealt');
    else if (pr.index !== r.index) notify('role', 'New round. Wait for your new card.');
    else if (pr.status !== r.status) {
      if (r.status === 'running' && pr.status === 'lobby') notify('role', 'The round has started');
      else if (r.status === 'paused') notify('soft', 'Paused by the evaluator');
      else if (r.status === 'running') notify('soft', 'Resumed');
      else if (r.status === 'ended') notify('role', 'Round finished');
    }
    return;
  }
  if (prev.round.index !== r.index) archived = null;
  for (const inc of r.incidents) {
    if (inc.status === 'active' && !seenIncidents.has(inc.id)) { seenIncidents.add(inc.id); notify('soft', `Card dealt: ${inc.title} → ${pname(inc.participantId)}`); }
    const before = pr.incidents.find(x => x.id === inc.id);
    if (before && before.status === 'active' && inc.status === 'resolved' && !ratingDone(inc)) notify('soft', `Rate how "${inc.title}" was handled`);
  }
  if (pr.status !== 'ended' && r.status === 'ended') notify('role', 'Round finished. Time to review.');
}
function checkTimeWarnings() {
  if (!S || !S.round || S.round.status !== 'running') return;
  const key = S.code + ':' + S.round.index, left = remainingNow();
  const trainer = S.kind === 'participant' && S.me?.type && S.me.type !== 'student';
  if ((isStaff() || trainer) && left <= 120000 && left > 110000 && !warnedTwoMin[key]) { warnedTwoMin[key] = true; notify('soft', '2 minutes left'); }
}

// ---------------- UI helpers ----------------
let toastTimer = null;
function toast(msg, err = false, undo = null) {
  clearTimeout(toastTimer); lastToastUndo = undo;
  toastEl.className = 'toast show' + (err ? ' err' : '');
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-a="undo">Undo</button>' : ''}`;
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; lastToastUndo = null; }, undo ? 6000 : err ? 5000 : 3000);
}
function modal(html, { center = false, onClose } = {}) {
  modalRoot.innerHTML = `<div class="overlay ${center ? 'center' : ''}" data-a="modal-bg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  modalRoot._onClose = onClose;
  setTimeout(() => modalRoot.querySelector('[autofocus]')?.focus(), 50);
}
function closeModal() { const cb = modalRoot._onClose; modalRoot.innerHTML = ''; modalRoot._onClose = null; cb?.(); if (pendingRender) render(true); }
function confirmBox(msg, ok = 'Yes', danger = false) {
  return new Promise(resolve => {
    modal(`<h2>${esc(msg)}</h2><div class="row" style="margin-top:1.2rem"><button class="btn btn-lg grow" data-a="cf-no">Cancel</button><button class="btn btn-lg grow ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-a="cf-yes">${esc(ok)}</button></div>`, { center: true, onClose: () => resolve(false) });
    modalRoot._resolve = resolve;
  });
}
function seg(name, options, current, extra = '', compact = false) {
  return `<div class="seg ${compact ? 'compact' : ''}" role="group">${options.map(([v, l, tone]) => `<button type="button" class="${String(current) === String(v) ? 'on ' + (tone || '') : ''}" data-seg="${esc(name)}" data-v="${esc(v)}" ${extra} aria-pressed="${String(current) === String(v)}">${esc(l)}</button>`).join('')}</div>`;
}

// iPhone tap haptic: iOS gives a haptic tick only when a finger really taps a native switch
// (since iOS 26.5, script-triggered taps no longer count). So tappable cards and quick-log buttons
// carry an invisible switch on top. Android gets a short vibration on the same taps.
const HAPT = '<input type="checkbox" switch class="hapt" aria-hidden="true" tabindex="-1">';
function tapBuzz() { if (prefs.vibrate && canVibrate()) { try { navigator.vibrate(18); } catch {} } }

// ---------------- playing cards ----------------
// opts: {id, kind: role|scenario|trainer, color, sym, k, n, body, foot:[l,r], back:{kind, who}, flipped, static, deal, action}
function cardHTML(o) {
  const backCls = { role: 'back-role', scenario: 'back-scenario', trainer: 'back-trainer' }[o.kind];
  return `<div class="pcard c-${esc(o.color)} ${o.flipped || o.static ? 'is-flipped' : ''} ${o.static ? 'static' : ''} ${o.deal ? 'deal' : ''}" ${o.static ? '' : `role="button" tabindex="0" data-a="${o.action || 'flip'}" data-id="${esc(o.id)}" aria-label="${esc(o.back.kind)}: tap to flip"`}>
    ${o.static ? '' : HAPT}<div class="pcard-inner">
      <div class="face back ${backCls}" aria-hidden="${o.flipped ? 'true' : 'false'}"><div class="back-emblem"><div class="mark">${esc(o.backMark || 'CS')}</div><div class="kind">${esc(o.back.kind)}</div><div class="who">${esc(o.back.who || 'ClassroomSim')}</div></div><span class="tapflip">Tap to flip</span></div>
      <div class="face front" aria-hidden="${o.flipped || o.static ? 'false' : 'true'}">
        <div class="band"><span class="sym">${esc(o.sym)}</span><div><div class="k">${esc(o.k)}</div><div class="n">${esc(o.n)}</div></div></div>
        <div class="cbody">${o.body}</div>
        <div class="cfoot"><span>${esc(o.foot[0])}</span><span>${esc(o.foot[1])}</span></div>
      </div>
    </div></div>`;
}
function scenarioCard(sc, { id, flipped, deal, staticCard, roundIndex, who, action } = {}) {
  const c = sc.color;
  return cardHTML({
    id, kind: 'scenario', color: c, sym: ROLE[c]?.sym || '!', k: `Scenario card · ${c}`, n: sc.title, flipped, deal, static: staticCard, action,
    back: { kind: 'Scenario card', who: who || 'For your eyes only' }, backMark: '⚡',
    body: `<div class="eyebrow">Do this now</div><p class="do">${esc(sc.instruction)}</p>
      <div class="csec"><div class="eyebrow">If a trainer comes to you, say</div><p>${esc(sc.response)}</p></div>
      <div class="csec"><div class="eyebrow">When they help you well</div><p>${esc(sc.recovery)}</p></div>`,
    foot: [`Round ${roundIndex ?? '–'} · ${PHASES[sc.phase] || sc.phase || ''}`, sc.difficulty === 'custom' ? 'Custom' : sc.id]
  });
}
function roleCard(view, { flipped, deal }) {
  const r = view.round, t = view.me.type;
  if (t === 'lead' || t === 'support') {
    const lead = t === 'lead';
    return cardHTML({
      id: 'role-' + r.index, kind: 'trainer', color: t, sym: lead ? '★' : '◇', k: 'Trainer card', n: lead ? 'Lead Trainer' : 'Support Trainer', flipped, deal,
      back: { kind: 'Trainer card', who: view.me.name }, backMark: lead ? '★' : '◇',
      body: `<p class="do">${lead ? 'Teach your planned lesson and respond to what happens in the class. You are being assessed.' : 'Help learners and back up the Lead Trainer. You get feedback, not a score.'}</p>
        ${r.partnerName ? `<div class="csec"><div class="eyebrow">${lead ? 'Your Support Trainer' : 'Your Lead Trainer'}</div><p><b>${esc(r.partnerName)}</b></p></div>` : ''}
        <div class="csec"><div class="eyebrow">Tips</div><p>Some learners hold secret cards. Watch the whole room. ${lead ? 'Use your Support Trainer when you need to.' : 'Check with the Lead Trainer before you step in.'} Your phone buzzes at 2 minutes left.</p></div>`,
      foot: [`Round ${r.index}`, lead ? 'Assessed' : 'Feedback only']
    });
  }
  const c = r.myRole, info = ROLE[c] || ROLE.normal;
  return cardHTML({
    id: 'role-' + r.index, kind: 'role', color: c, sym: info.sym, k: `Role card · ${c === 'normal' ? 'regular' : c}`, n: info.name, flipped, deal,
    back: { kind: 'Role card', who: view.me.name }, backMark: '?',
    body: `<p class="do">${esc(info.desc)}</p>
      <div class="csec"><div class="eyebrow">How to play</div><p>${c === 'normal' ? 'Join in normally for the whole round.' : 'Join in normally. When a Scenario card arrives, flip it and act it out quietly.'}</p></div>
      <div class="csec"><div class="eyebrow">Keep it safe</div><p>Stay realistic and respectful. No insults, no physical contact, nothing unsafe.</p></div>`,
    foot: [`Round ${r.index}`, 'Keep it secret']
  });
}

// ---------------- rendering ----------------
function fieldFocused() {
  const a = document.activeElement;
  return a && app.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox') || a.tagName === 'SELECT');
}
function render(force = false) {
  if (!force && (fieldFocused() || modalRoot.firstChild)) { pendingRender = true; paintLive(); return; }
  pendingRender = false;
  const y = window.scrollY;
  document.body.classList.toggle('no-nav', !isStaff());
  if (bootError) app.innerHTML = renderBootError();
  else if (!identity) app.innerHTML = renderLanding();
  else if (!S) app.innerHTML = `<div class="boot"><div><img src="${FAV}" width="60" height="60" alt="" style="border:2px solid #162334;border-radius:12px"><p>Connecting to session <b>${esc(identity.code)}</b>…</p><button class="btn" data-a="leave-now">Cancel</button></div></div>`;
  else if (S.kind === 'participant') app.innerHTML = renderParticipant();
  else app.innerHTML = renderStaff();
  window.scrollTo(0, y);
  paintLive();
  if (S && S.kind === 'participant') maybeDeal();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !fieldFocused() && !modalRoot.firstChild) render(true); }, 120));
function paintLive() {
  const qj = document.getElementById('qr-joined'); if (qj && S?.participants) qj.textContent = S.participants.length;
  if (!S || !S.round) return;
  const left = remainingNow(), r = S.round;
  document.querySelectorAll('[data-timer]').forEach(el => { el.textContent = mmss(left); el.classList.toggle('low', r.status === 'running' && left < 120000); });
  const p = $('#progress'); if (p && r.durationMinutes) p.style.width = (100 * left / (r.durationMinutes * 60000)) + '%';
  document.querySelectorAll('[data-age]').forEach(el => { el.textContent = mmss(Math.max(0, elapsedNow() - Number(el.dataset.age))); });
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = 'in ' + mmss(Math.max(0, Number(el.dataset.until) * 1000 - elapsedNow())); });
}
setInterval(() => { paintLive(); checkTimeWarnings(); }, 250);

function renderBootError() {
  return `<div class="landing"><div class="land-in"><div class="brand"><img src="${FAV}" alt="">ClassroomSim</div>
    <div class="card raised" style="margin-top:1.5rem"><h2>Can't connect yet</h2><p><b>${esc(bootError.message || bootError)}</b></p>
    ${bootError.help ? `<div class="note" style="margin:.6rem 0"><b>How to fix it:</b> ${esc(bootError.help)}</div>` : ''}
    <p class="small muted">Participants never see this once setup is done. ${bootError.code ? `Error code: <span class="mono">${esc(bootError.code)}</span>` : ''}</p>
    <button class="btn btn-primary" data-a="retry">Try again</button></div></div></div>`;
}

// ---------- landing ----------
function renderLanding() {
  const q = new URLSearchParams(location.search);
  const joinCode = q.get('join'), staffCode = q.get('staff') || q.get('eval');
  const evalKey = (() => { try { return new URLSearchParams(location.hash.slice(1)).get('k') || ''; } catch { return ''; } })();
  if (joinCode && landing === 'home') landing = 'join';
  if (staffCode && landing === 'home') { landing = 'staff'; staffTab = 'pin'; }
  let body = '';
  if (landing === 'home') {
    body = `<div class="hero"><div class="fan" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <h1>Classroom role-play, dealt to your phone.</h1><p>Practise leading a class. Learners get secret cards, trainers face real situations, and evaluators run it and capture it all.</p></div>
      <button class="choice" data-a="land" data-to="join"><span class="ico" style="background:var(--r-blue);color:#fff">🂠</span><span><b>Join a class</b><span class="d">I'm a participant</span></span><span class="go">›</span></button>
      <button class="choice" data-a="land" data-to="staff"><span class="ico" style="background:var(--sun)">📋</span><span><b>Evaluator</b><span class="d">I'm running and assessing the role-play</span></span><span class="go">›</span></button>
      <p class="footer-note">No account needed. Your cards are private to your phone.</p>`;
  } else if (landing === 'join') {
    body = `<div class="hero"><h1>Join your class</h1><p>Type your name and the 6-letter code on the screen.</p></div>
      <form class="card raised" id="join-form" autocomplete="off">
      <div class="field"><label class="lbl" for="j-name">Your name</label><input id="j-name" name="name" required minlength="2" maxlength="64" placeholder="e.g. Sarah Tan" autocomplete="name" ${joinCode ? 'autofocus' : ''}></div>
      <div class="field"><label class="lbl" for="j-code">Session code</label><input id="j-code" name="code" class="code-input" required minlength="6" maxlength="6" placeholder="ABC234" value="${esc(joinCode || '')}" autocapitalize="characters" spellcheck="false"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Join class</button>
      <p class="hint" style="text-align:center">Keep this page open. Your cards are dealt here.</p></form>
      <button class="back" data-a="land" data-to="home">‹ Back</button>`;
  } else {
    const mine = mySessions();
    body = `<div class="hero"><h1>Evaluator</h1><p>Start a new session, or join one with an evaluator code.</p></div>
      ${mine.length ? `<section class="card raised" style="margin-bottom:1.2rem"><h3>Your sessions on this device</h3><p class="small muted" style="margin-top:0">Run several classes and switch between them any time.</p>${mine.map(x => `<div class="sess-row"><div class="grow"><b>${esc(x.topic || 'Session')}</b><div class="small muted"><span class="codechip">${esc(x.code)}</span> ${esc(x.cohort || '')}${x.cohort ? ' · ' : ''}${new Date(x.at).toLocaleDateString()}</div></div><button class="btn btn-sm btn-primary" data-a="openSession" data-v="${esc(x.code)}">Open</button><button class="btn btn-sm btn-quiet" data-a="forgetSession" data-v="${esc(x.code)}" aria-label="Remove from this list">✕</button></div>`).join('')}</section>` : ''}
      <div class="tabs2"><button class="${staffTab === 'new' ? 'on' : ''}" data-a="staffTab" data-v="new">Start a session</button><button class="${staffTab === 'pin' ? 'on' : ''}" data-a="staffTab" data-v="pin">Join with evaluator code</button></div>
      ${staffTab === 'new' ? `<form class="card raised" id="create-form" autocomplete="off">
        <div class="field"><label class="lbl" for="c-name">Your name</label><input id="c-name" name="instructorName" maxlength="70" placeholder="e.g. Louis" required></div>
        <div class="field"><label class="lbl" for="c-cohort">Class or cohort</label><input id="c-cohort" name="cohort" maxlength="80" placeholder="e.g. CET Cohort 07"></div>
        <div class="field"><label class="lbl" for="c-topic">Lesson topic</label><input id="c-topic" name="lessonTopic" maxlength="130" placeholder="e.g. Prompting an AI chatbot"></div>
        <div class="field"><label class="lbl" for="c-pass">Start passcode</label><input id="c-pass" name="startPasscode" type="password" maxlength="64" autocomplete="off" placeholder="From your course admin"><p class="hint">Only needed if your course admin has set one. It stops anyone else from starting sessions.</p></div>
        <div class="field"><span class="lbl">Length of each teaching round</span>${seg('c-dur', [[5, '5 min'], [10, '10 min'], [15, '15 min'], [20, '20 min']], createDraft.dur)}</div>
        <div class="field"><span class="lbl">Mode</span>${seg('c-mode', [['practice', 'Practice'], ['assessment', 'Assessment']], createDraft.mode)}<p class="hint" id="mode-hint">${MODE_HINT[createDraft.mode]}</p></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Create session</button></form>`
      : `<form class="card raised" id="staff-form" autocomplete="off">
        <div class="field"><label class="lbl" for="e-name">Your name</label><input id="e-name" name="name" required minlength="2" maxlength="64" placeholder="e.g. Ms Koh"></div>
        <div class="field"><label class="lbl" for="e-code">Session code</label><input id="e-code" name="code" class="code-input" required minlength="6" maxlength="6" value="${esc(staffCode || '')}" placeholder="ABC234" autocapitalize="characters" spellcheck="false"></div>
        <div class="field"><label class="lbl" for="e-pin">Evaluator code</label><input id="e-pin" name="pin" class="code-input evcode" required minlength="10" maxlength="14" placeholder="XXXX-XXXX-XX" value="${esc(evalKey)}" autocapitalize="characters" spellcheck="false" autocomplete="off"><p class="hint">10 letters and numbers from the evaluator who started the session. Dashes and capitals don't matter.</p></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Join as evaluator</button></form>`}
      <button class="back" data-a="land" data-to="home">‹ Back</button>`;
  }
  return `<div class="landing"><div class="land-in"><div class="brand"><img src="${FAV}" alt="">ClassroomSim</div>${body}</div></div>`;
}
const createDraft = { dur: 10, mode: 'practice' };
const MODE_HINT = { practice: 'Practice: flexible. Deal any scenario card whenever you like.', assessment: 'Assessment: every card dealt is logged so each candidate gets a fair, comparable round.' };

// ---------- participant ----------
function renderParticipant() {
  const head = `<div class="p-head"><div class="brand grow"><img src="${FAV}" alt="">ClassroomSim</div><span id="conn" class="dot ${online ? 'on' : 'off'}" title="Connection"></span><button class="btn btn-icon btn-quiet" data-a="settings" aria-label="Settings">⚙</button></div>`;
  const enable = alertsUnlocked ? '' : `<button class="enable" data-a="enable-alerts"><span class="ico">🔔</span><span><b>Tap here to turn on alerts</b><br><span class="small">${canVibrate() ? 'Your phone will vibrate and chime when a card is dealt to you.' : 'Your phone will chime and flash when a card is dealt. (iPhones only allow a light tap, not full vibration.)'}</span></span></button>`;
  if (S.waiting || S.pending) {
    return `<div class="p-page">${head}${enable}<div class="deck"><div class="slot"><div><div style="font-size:2rem">${S.pending ? '✋' : '⏳'}</div><h3>${S.pending ? 'Not in yet' : "You're signed in"}</h3><p class="small">${esc(S.pending ? S.message : 'Waiting for an evaluator’s screen to add you. Keep this page open.')}</p></div></div>
      ${S.pending ? `<form id="rename-form" class="card-actions"><label class="lbl" for="r-name">Change your name</label><input id="r-name" name="name" minlength="2" maxlength="64" value="${esc(S.me?.name || '')}"><button class="btn btn-primary" type="submit">Try again with this name</button></form>` : ''}</div>
      <p class="footer-note"><button class="back" data-a="leave">Leave session</button></p></div>`;
  }
  const r = S.round, me = S.me, f = flipped();
  const roleKey = 'role-' + r.index;
  const active = (r.incidents || []).find(x => x.status === 'active');
  const done = (r.incidents || []).filter(x => x.status === 'resolved');
  let deck = '';
  if (active && f.has(active.id) && active.scenario) {
    deck += scenarioCard(active.scenario, { id: active.id, flipped: f.has('show-' + active.id) || true, roundIndex: r.index, action: 'flip-sc', who: me.name });
    deck += `<div class="card-actions">${active.intervenedAt || f.has('appr-' + active.id) ? `<p class="hint" style="text-align:center">✓ You marked that a trainer came to you.</p>` : `<button class="btn btn-lg btn-block" data-a="intervened" data-id="${esc(active.id)}">A trainer came to me</button>`}</div>`;
  }
  if (!r.isAssigned) {
    deck += `<div class="slot"><div><div style="font-size:2rem">🂠</div><h3>Your card goes here</h3><p class="small">The evaluator deals the cards when everyone is in. Keep this page open.</p></div></div>`;
  } else {
    const deal = !dealtKeys.has(roleKey); dealtKeys.add(roleKey);
    deck += roleCard(S, { flipped: f.has(roleKey), deal });
    deck += `<p class="hint" style="text-align:center;margin:0">${f.has(roleKey) ? 'Tap the card to turn it face down again.' : 'Only you can see it. Tap to flip it open.'}</p>`;
  }
  if (done.length) deck += `<div class="played"><div class="eyebrow">Played this round (${done.length})</div>${done.map(d => `<div class="mini"><span class="cbar ${esc(d.scenario?.color)}"></span>${esc(d.scenario?.title || 'Scenario')} <span class="muted small" style="margin-left:auto">✓ done</span></div>`).join('')}</div>`;
  return `<div class="p-page">${head}
    <div class="p-status"><div class="grow"><b>${esc(me.name)}</b><div>Round ${r.index} · ${statusText(r.status)}${r.status === 'running' ? ' · ' + esc(PHASES[r.activity] || '') : ''}</div></div><div class="scoreboard" data-timer>${mmss(r.remainingMs)}</div></div>
    ${enable}<div class="deck">${deck}</div>
    <p class="footer-note">Act out a card only when it is dealt to you. Keep it realistic and respectful.</p></div>`;
}
// A new scenario card is dealt face-down on a full-screen table. Tapping it flips it open (= "I've read it").
function maybeDeal() {
  const active = (S.round?.incidents || []).find(x => x.status === 'active' && x.scenario);
  const felt = document.getElementById('table-felt');
  if (!active) { felt?.remove(); return; }
  const f = flipped();
  if (f.has(active.id) && !felt) return;
  if (felt && felt.dataset.id === active.id) return;
  felt?.remove();
  const el = document.createElement('div');
  el.id = 'table-felt'; el.className = 'table-felt'; el.dataset.id = active.id; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'New scenario card');
  el.innerHTML = `<div class="msg">🔔 You've been dealt a Scenario card</div>${scenarioCard(active.scenario, { id: active.id, deal: true, roundIndex: S.round.index, action: 'flip-new', who: S.me.name })}<p class="msg small" id="felt-hint" style="font-size:.95rem;font-weight:600">Only you can see this. Tap the card to flip it open.</p>`;
  document.body.appendChild(el);
}

// ---------- staff shell ----------
const TABS = [['setup', '⚙︎', 'Set up'], ['run', '▶︎', 'Run'], ['observe', '✎', 'Observe'], ['review', '☑︎', 'Review'], ['records', '⤓', 'Records']];
function toRate(r) { return r.incidents.filter(i => i.status !== 'cancelled' && !ratingDone(i)).length; }
function renderStaff() {
  const r = S.round;
  if (!view) view = r.status === 'lobby' ? 'setup' : 'run';
  const activeCount = r.incidents.filter(i => i.status === 'active').length;
  const badges = { observe: toRate(r) };
  const nav = `<nav class="bottomnav" aria-label="Sections"><div class="navbrand brand"><img src="${FAV}" alt="">ClassroomSim</div>${TABS.map(([k, i, l]) => `<button class="${view === k ? 'on' : ''}" data-a="nav" data-v="${k}" aria-current="${view === k}"><span class="i">${i}</span>${l}${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('')}</nav>`;
  const bar = `<header class="topbar"><span id="conn" class="dot ${online ? 'on' : 'off'}" title="Connection"></span>
    <div class="t"><b>${esc(S.lessonTopic)}</b><span>Code ${esc(S.code)} · Round ${r.index} · <span class="st ${r.status}">${statusText(r.status)}</span></span></div>
    ${activeCount ? `<button class="pill" data-a="nav" data-v="observe">${activeCount} live</button>` : ''}
    <div class="scoreboard" data-timer>${mmss(r.remainingMs)}</div>
    <button class="iconbtn qrbtn" data-a="showQR" aria-label="Show the join QR code">QR</button>
    <button class="iconbtn" data-a="settings" aria-label="Settings">⚙</button></header>`;
  const page = { setup: viewSetup, run: viewRun, observe: viewObserve, review: viewReview, records: viewRecords }[view]();
  return `<div class="shell">${nav}<div class="content">${bar}<main class="main">${page}</main></div></div>`;
}

function nextStepCard() {
  const r = S.round, ps = S.participants;
  let msg, sub = '', btn = '';
  if (r.status === 'lobby') {
    if (ps.length < 4) { msg = `Waiting for people to join (${ps.length} so far, at least 4 needed)`; sub = 'Put the QR code on the projector so everyone can scan it.'; btn = `<button class="btn btn-blue" data-a="showQR">Show QR on screen</button>`; }
    else if (!(r.leadId && r.supportId)) { msg = 'Next: choose the Lead and Support Trainers'; sub = 'Step 2 below.'; }
    else if (!r.assignedAt) { msg = 'Next: deal the secret role cards'; sub = 'Step 3 below. Each person only sees their own card.'; }
    else { msg = 'All set. Ready to start.'; sub = 'Press Start when the Lead Trainer begins teaching.'; btn = `<button class="btn btn-primary btn-lg" data-a="start">▶ Start round ${r.index}</button>`; }
  } else if (r.status === 'ended') { msg = 'Round finished'; sub = 'Finish the Review, then start the next round. Trainers rotate automatically.'; btn = `<button class="btn btn-primary" data-a="nextRound">Next round ›</button>`; }
  else { msg = r.status === 'running' ? 'Round is live' : 'Round is paused'; sub = 'Setup is locked while the round runs.'; btn = `<button class="btn btn-primary" data-a="nav" data-v="run">Go to Run ›</button>`; }
  return `<section class="nextstep"><div class="grow"><div class="eyebrow" style="color:var(--sun-ink)">What to do now</div><div class="ns-m">${esc(msg)}</div>${sub ? `<div class="ns-s">${esc(sub)}</div>` : ''}</div>${btn}</section>`;
}

// ---------- setup ----------
function viewSetup() {
  const r = S.round, ps = S.participants, lobby = r.status === 'lobby';
  const done = { 1: ps.length >= 4, 2: !!(r.leadId && r.supportId), 3: !!r.assignedAt, 4: !!r.assignedAt };
  const current = [1, 2, 3, 4].find(n => !done[n]) || 4;
  const isOpen = n => lobby && (openStep ? openStep === n : n === current);
  const lead = r.leadId || ps[0]?.id || '', support = r.supportId || ps.find(p => p.id !== lead)?.id || '';
  const step = (n, title, summary, inner) => {
    if (isOpen(n)) return `<section class="card step-open"><div class="step"><span class="num-badge">${n}</span><div class="grow"><h3>${title}</h3>${inner}</div></div></section>`;
    const can = lobby && done[n];
    return `<div class="step-row ${done[n] ? 'done' : 'todo'}"><span class="num-badge">${done[n] ? '✓' : n}</span><div class="grow"><b>${title}</b><div class="small muted">${done[n] ? summary : `Do step ${n - 1} first`}</div></div>${can ? `<button class="btn btn-sm" data-a="openStep" data-v="${n}">Change</button>` : ''}${n === 1 ? `<button class="btn btn-sm" data-a="showQR">Show QR</button>` : ''}</div>`;
  };
  const scheduled = r.planned.slice().sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const auto = r.autoPrompts !== false;
  const waiting = S.waiting || [];
  return `<div class="page-title"><h1>Set up round ${r.index}</h1></div>
  ${nextStepCard()}
  <div class="cols cols-main"><div class="stack-sm">
    ${step(1, 'Everyone joins', `${ps.length} people joined · code ${esc(S.code)}`, `<p class="small muted">People scan the QR code, or open the link and type the code.</p>
      <div class="row" style="align-items:flex-start;gap:1rem"><div class="qr" aria-label="QR code to join">${qrSvg()}</div><div class="grow" style="min-width:200px"><div class="eyebrow">Session code</div><div class="bigcode">${esc(S.code)}</div><div class="linkbox">${esc(joinUrl())}</div>
      <div class="row" style="margin-top:.7rem"><button class="btn btn-blue" data-a="showQR">Show QR on screen</button><button class="btn" data-a="copy" data-link="join">Copy link</button></div></div></div>
      <p class="hint">${ps.length} joined so far. Carry on when everyone is in (at least 4).</p>`)}
    ${step(2, 'Choose the trainers', `Lead: ${esc(pname(r.leadId))} · Support: ${esc(pname(r.supportId))}`, `<div class="cols cols-2"><div class="field"><label class="lbl" for="lead-sel">Lead Trainer <span class="chip info">Assessed</span></label><select id="lead-sel">${ps.map(p => `<option value="${esc(p.id)}" ${p.id === lead ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label class="lbl" for="sup-sel">Support Trainer <span class="chip">Feedback only</span></label><select id="sup-sel">${ps.map(p => `<option value="${esc(p.id)}" ${p.id === support ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div><button class="btn btn-primary" data-a="setTrainers">Confirm trainers</button>`)}
    ${step(3, 'Deal the secret role cards', `${Object.values(r.roles).filter(c => c !== 'normal').length} colour role cards dealt (${r.perColour || 1} of each colour)`, `<div class="field"><span class="lbl">How many of each colour?</span>${seg('percolour', [[1, '1 each (5 cards)'], [2, '2 each (10)'], [3, '3 each (15)']], r.perColour || 1, '', true)}
      <p class="hint">${(() => { const n = Math.max(0, ps.length - 2), sug = n >= 18 ? 3 : n >= 12 ? 2 : 1; return `${n} learners. Suggested: <b>${sug} of each</b>. Everyone else gets a regular learner card.`; })()}</p></div>
      <p class="small muted">Phones buzz when their card arrives. Each person only sees their own card.</p><button class="btn btn-primary" data-a="assignRoles">${r.assignedAt ? 'Reshuffle and deal again' : 'Deal role cards'}</button>
      ${r.assignedAt ? `<div style="margin-top:.7rem">${ps.filter(p => r.roles[p.id]).map(p => `<div class="person"><span class="avatar">${esc(p.name[0].toUpperCase())}</span><span class="grow">${esc(p.name)}</span>${roleBadge(r.roles[p.id])}</div>`).join('')}</div>` : ''}`)}
    ${step(4, 'Round length and scenario cards', `${r.durationMinutes} min · ${auto ? scheduled.length + ' cards on a timeline' : 'cards dealt by hand'}`, `<div class="field"><span class="lbl">Round length</span>${seg('duration', S.durationOptions.map(d => [d, d + ' min']), r.durationMinutes, '', true)}</div>
      <div class="field"><span class="lbl">How should scenario cards be dealt?</span>${seg('automode', [['auto', 'Automatically on a timeline'], ['manual', 'Only when an evaluator taps Deal']], auto ? 'auto' : 'manual', '', true)}
      <p class="hint">${auto ? 'The app deals these at the times below. Any evaluator can still deal extra ones.' : 'Nothing is dealt by itself. Evaluators choose each card during the round.'}</p></div>
      ${auto ? (scheduled.length ? scheduled.map(p => { const sc = S.scenarios.find(x => x.id === p.scenarioId); return `<div class="incident"><span class="cbar ${esc(sc?.color)}"></span><div class="grow"><div class="t">${mmss(p.offsetSeconds * 1000)} · ${esc(sc?.title || '')}</div><div class="small muted">${esc(pname(p.participantId))}</div></div><button class="btn btn-sm btn-quiet" data-a="removePlan" data-id="${esc(p.id)}" aria-label="Remove">✕</button></div>`; }).join('') : '<div class="empty">No timed cards.</div>')
      + `<div class="row" style="margin-top:.5rem"><button class="btn btn-sm" data-a="planDefault">↻ New random timeline</button></div>
      <details style="margin-top:.4rem"><summary>Add one at a set time</summary><form id="plan-form" class="stack-sm"><select name="scenarioId">${S.scenarios.filter(sc => Object.values(r.roles).includes(sc.color)).map(sc => `<option value="${esc(sc.id)}">${esc(sc.color.toUpperCase() + ' · ' + sc.title)}</option>`).join('')}</select><div class="row nowrap"><label class="small grow">Minutes into round<input name="min" type="number" min="0" max="${r.durationMinutes - 1}" value="3" step="0.5"></label><button class="btn btn-primary" type="submit" style="margin-top:1.4rem">Add</button></div></form></details>` : ''}`)}
  </div><div class="stack">
    <section class="card"><div class="card-head"><h3>People (${ps.length})</h3>${chip(ps.filter(p => p.online).length + ' online', 'good')}</div>
      <div class="${ps.length > 12 ? 'peoplelist' : ''}">${ps.length ? ps.map(p => `<div class="person"><span class="dot ${p.online ? 'on' : ''}"></span><span class="grow">${esc(p.name)}</span>${p.id === r.leadId ? '<span class="role lead">★ Lead</span>' : p.id === r.supportId ? '<span class="role support">◇ Support</span>' : r.roles[p.id] ? roleBadge(r.roles[p.id]) : ''}${lobby ? `<button class="btn btn-sm btn-quiet" data-a="removeParticipant" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</div>`).join('') : '<div class="empty">Nobody yet. Show the QR code.</div>'}</div>
      ${waiting.length ? `<div class="note warn small" style="margin-top:.6rem"><b>Waiting to get in:</b> ${waiting.map(w => esc(w.name)).join(', ')}. They join at the next round, or need to change a name already in use.</div>` : ''}
      <p class="hint">Green dot means their phone checked in during the last minute or so.</p></section>
    <section class="card"><h3>Evaluators</h3><p class="small muted">Other evaluators join with this code on their own phone or laptop. Anyone with it can change results, so send it privately. Never put it on the projector or in a class chat.</p>
      <div class="eyebrow">Evaluator code</div><div class="row"><div class="bigcode evc">${esc(S.evaluatorPin)}</div>${S.me.isOwner ? '<button class="btn btn-sm btn-quiet" data-a="newPin">New code</button>' : ''}</div>
      <button class="btn btn-sm" style="margin-top:.5rem" data-a="copy" data-link="evalinvite">Copy private evaluator invite</button>
      <p class="hint">The invite link has the code built in. ${S.me.isOwner ? 'Removing an evaluator changes the code automatically.' : 'Only the evaluator who started the session can remove evaluators or change the code.'}</p>
      <div style="margin-top:.6rem"><div class="person"><span class="dot on"></span><span class="grow">${esc(S.instructorName)} <span class="xs muted">(created the session)</span></span></div>${(S.evaluators || []).map(e => `<div class="person"><span class="dot ${e.online ? 'on' : ''}"></span><span class="grow">${esc(e.name)}</span>${e.id === S.me.id ? '<span class="xs muted">you</span>' : S.me.isOwner ? `<button class="btn btn-sm btn-quiet" data-a="removeEvaluator" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">✕</button>` : ''}</div>`).join('')}</div></section>
  </div></div>`;
}
function showQR(fresh = false) {
  modal(`<div style="text-align:center">${fresh ? '<div class="chip good" style="margin-bottom:.5rem">✓ Session created</div>' : ''}<h2>Scan to join</h2><p class="muted" style="margin-top:0">${esc(S.lessonTopic)} · ${esc(S.cohort)}</p>
    <div class="qr-big">${qrSvg()}</div>
    <div class="row" style="justify-content:center;gap:1.2rem;margin-top:.4rem"><div><div class="eyebrow">Session code</div><div class="bigcode" style="font-size:2.6rem">${esc(S.code)}</div></div><div><div class="eyebrow">Joined</div><div class="bigcode" style="font-size:2.6rem;letter-spacing:0" id="qr-joined">${S.participants.length}</div></div></div>
    <div class="linkbox" style="margin:.5rem auto;max-width:420px">${esc(joinUrl())}</div>
    <p class="small muted">Put this on the projector. The count goes up as people join. The evaluator code is never shown here, so it stays private.</p>
    <div class="row" style="margin-top:.6rem"><button class="btn grow" data-a="copy" data-link="join">Copy link</button><button class="btn btn-primary grow" data-a="close">${fresh ? 'Done, go to Set up' : 'Close'}</button></div></div>`, { center: true });
}

// ---------- run ----------
function liveList() {
  const act = S.round.incidents.filter(i => i.status === 'active');
  if (!act.length) return '<div class="empty">No cards in play. Learners are behaving normally.</div>';
  return act.map(i => `<div class="incident"><span class="cbar ${esc(i.color)}"></span><div class="grow"><div class="t">${esc(i.title)}</div><div class="small muted">${esc(pname(i.participantId))} · ${i.acknowledgedAt ? '✓ flipped open' : '⏳ not flipped yet'}${i.intervenedAt ? ' · a trainer went over' : ''}${i.sentBy ? ' · dealt by ' + esc(i.sentBy) : ' · from timeline'} · <span data-age="${i.triggerElapsedMs}"></span> ago</div><div class="row" style="margin-top:.45rem"><button class="btn btn-sm btn-good" data-a="resolve" data-id="${esc(i.id)}">✓ Done, end it</button><button class="btn btn-sm btn-quiet" data-a="cancel" data-id="${esc(i.id)}">Cancel</button></div></div></div>`).join('') + '<p class="hint">A card ends by itself after 90 seconds.</p>';
}
function sendPanel() {
  const r = S.round, live = r.status === 'running';
  if (!r.assignedAt) return '<div class="empty">Role cards have not been dealt yet.</div>';
  const order = ['red', 'yellow', 'blue', 'black', 'green'];
  const all = S.participants.filter(p => r.roles[p.id] && r.roles[p.id] !== 'normal').sort((a, b) => order.indexOf(r.roles[a.id]) - order.indexOf(r.roles[b.id]));
  const learners = sendFilter === 'all' ? all : all.filter(p => r.roles[p.id] === sendFilter);
  const pills = all.length > 5 ? `<div class="pills">${['all', ...order].map(c => `<button class="${sendFilter === c ? 'on' : ''}" data-a="sendfilter" data-v="${c}">${c === 'all' ? 'All (' + all.length + ')' : ROLE[c].sym + ' ' + c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>` : '';
  const act = r.incidents.filter(i => i.status === 'active');
  return `<div class="field"><span class="lbl">Lesson moment now</span>${seg('phase', Object.entries(PHASES), r.activity, '', true)}<p class="hint">Cards that fit this moment are highlighted and listed first.</p></div>
  ${live ? '' : '<p class="note warn small">You can deal scenario cards once the round is running.</p>'}
  ${pills}<div class="learners">${learners.map(p => {
    const c = r.roles[p.id], busy = act.find(i => i.participantId === p.id);
    const list = S.scenarios.filter(sc => sc.color === c).sort((a, b) => (b.phase === r.activity) - (a.phase === r.activity));
    const btn = sc => `<button class="scb c-${esc(c)} ${sc.phase === r.activity ? 'fits' : ''}" data-a="preview" data-id="${esc(sc.id)}" data-pid="${esc(p.id)}" ${live && !busy ? '' : 'disabled'}><span>${esc(sc.title)}</span><small>${sc.phase === r.activity ? '★ Fits now' : esc(PHASES[sc.phase] || sc.phase)}</small></button>`;
    return `<div class="learner"><div class="lh"><span class="avatar">${esc(p.name[0].toUpperCase())}</span><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(ROLE[c].name)}</div></div>${roleBadge(c)}</div>
      ${busy ? `<div class="busy">Holding: <b>${esc(busy.title)}</b></div>` : ''}
      <div class="scs">${list.slice(0, 3).map(btn).join('')}</div>${list.length > 3 ? `<details><summary class="small">More cards for ${esc(p.name.split(' ')[0])} (${list.length - 3})</summary><div class="scs">${list.slice(3).map(btn).join('')}</div></details>` : ''}</div>`;
  }).join('')}</div>`;
}
function previewSheet(scId, pid) {
  const sc = S.scenarios.find(x => x.id === scId); if (!sc) return;
  modal(`<div class="eyebrow">Deal to ${esc(pname(pid))}</div><h2 style="margin:.15rem 0 .9rem">This is the card they will get</h2>
    <div class="deck">${scenarioCard(sc, { staticCard: true, roundIndex: S.round.index })}</div>
    <div class="row" style="margin-top:1.2rem"><button class="btn btn-lg grow" data-a="close">Cancel</button><button class="btn btn-lg btn-primary grow" data-a="sendNow" data-id="${esc(sc.id)}" data-pid="${esc(pid)}">Deal this card</button></div>`, { center: true });
}
function viewRun() {
  const r = S.round, live = r.status === 'running';
  const upcoming = r.planned.filter(p => p.state === 'pending').sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const controls = r.status === 'lobby' ? `<button class="btn btn-primary btn-lg grow" data-a="start" ${r.assignedAt ? '' : 'disabled'}>▶ Start</button>`
    : r.status === 'running' ? `<button class="btn btn-lg grow" data-a="pause">❚❚ Pause</button><button class="btn btn-lg btn-danger grow" data-a="end">■ End round</button>`
    : r.status === 'paused' ? `<button class="btn btn-primary btn-lg grow" data-a="resume">▶ Resume</button><button class="btn btn-lg btn-danger grow" data-a="end">■ End round</button>`
    : `<button class="btn btn-primary btn-lg grow" data-a="nextRound">Next round ›</button>`;
  const what = { lobby: r.assignedAt ? 'Press Start when the Lead Trainer begins.' : 'Finish Set up first (trainers and role cards).', running: r.autoPrompts !== false ? 'Cards go out on the timeline. Deal extra ones below if you like.' : 'Manual mode. Deal scenario cards below when the moment is right.', paused: 'Paused. No cards go out while paused.', ended: 'Round over. Finish the Review. Next round rotates the trainers.' }[r.status];
  return `<div class="cols cols-main"><div class="stack">
    <section class="card raised"><div class="row between"><span class="small muted">Round ${r.index} · Lead <b>${esc(r.leadName || '—')}</b> · Support <b>${esc(r.supportName || '—')}</b></span>${chip(statusText(r.status), live ? 'good' : r.status === 'paused' ? 'warn' : '')}</div>
      <div class="bigtimer" data-timer>${mmss(r.remainingMs)}</div><div class="progress"><i id="progress"></i></div>
      <p class="ns-s" style="margin:.6rem 0 0">${esc(what)}</p>
      <div class="row" style="margin-top:.8rem">${controls}</div></section>
    <section class="card"><div class="card-head"><h3>Cards in play</h3>${chip(r.incidents.filter(i => i.status === 'active').length + ' live', 'warn')}</div>${liveList()}</section>
    <section class="card"><h3>Deal a scenario card</h3><p class="small muted">Pick a learner, then a card. You will see the card before it is dealt.</p>${sendPanel()}</section>
  </div><div class="stack">
    ${r.autoPrompts !== false ? `<section class="card"><h3>Timeline</h3>${upcoming.length ? upcoming.map(p => { const sc = S.scenarios.find(x => x.id === p.scenarioId); return `<div class="incident"><span class="cbar ${esc(sc?.color)}"></span><div class="grow"><div class="t">${esc(sc?.title)}</div><div class="small muted">${esc(pname(p.participantId))} · at ${mmss(p.offsetSeconds * 1000)}${live ? ` · <span data-until="${p.offsetSeconds}"></span>` : ''}</div></div></div>`; }).join('') : '<div class="empty">Nothing else on the timeline.</div>'}</section>` : `<section class="note small"><b>Manual mode.</b> Nothing is dealt automatically. Any evaluator can deal cards from their own phone.</section>`}
    <section class="card"><details><summary>Write your own scenario card</summary><form id="custom-form" class="stack-sm" style="margin-top:.5rem">
      <div class="cols cols-2"><label class="small">Learner role<select name="color">${['red', 'yellow', 'blue', 'black', 'green'].map(c => `<option value="${c}">${ROLE[c].sym} ${c}</option>`).join('')}</select></label><label class="small">Lesson moment<select name="phase">${Object.entries(PHASES).map(([k, v]) => `<option value="${k}" ${k === r.activity ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <label class="small">Title<input name="title" required minlength="3" maxlength="100" placeholder="e.g. Uses chatbot for every answer"></label>
      <label class="small">What the learner should do<textarea name="instruction" required minlength="8" maxlength="800" placeholder="One clear, realistic action."></textarea></label>
      <label class="small">If a trainer comes over, say…<textarea name="response" maxlength="650" style="min-height:70px"></textarea></label>
      <label class="small">When helped well, do…<textarea name="recovery" maxlength="650" style="min-height:70px"></textarea></label>
      <div class="row"><button class="btn grow" type="submit">Save card</button><button class="btn btn-primary grow" type="submit" data-send="1" ${live ? '' : 'disabled'}>Save &amp; deal now</button></div></form></details></section>
    <section class="card"><details><summary>Activity log</summary><div class="log" style="margin-top:.4rem">${r.events.slice().reverse().slice(0, 30).map(e => `<div><span class="muted mono">${mmss(e.elapsed)}</span> · ${esc(e.detail)}</div>`).join('') || '<div class="muted">Nothing yet.</div>'}</div></details></section>
  </div></div>`;
}

// ---------- observe ----------
function rateBlock(inc, roundIndex) {
  const rt = inc.rating || {}, done = ratingDone(inc);
  return `<div class="rate-card ${done ? '' : 'todo'}"><div class="row nowrap"><span class="cbar ${esc(inc.color)}"></span><div class="grow"><b>${esc(inc.title)}</b><div class="small muted">${esc(pname(inc.participantId))} · ${roleBadge(inc.color)} · started ${mmss(inc.triggerElapsedMs)}${inc.status === 'active' ? ' · <b>live now</b>' : ''}</div></div>${done ? chip('✓ Rated', 'good') : chip('To rate', 'warn')}</div>
    ${Object.entries(RATE).map(([k, def]) => `<div class="rate-row"><span>${def.label}</span>${seg('rate', def.opts, rt[k], `data-inc="${esc(inc.id)}" data-field="${k}" data-round="${roundIndex}"`, true)}</div>`).join('')}
    <details style="margin-top:.3rem" ${rt.note ? 'open' : ''}><summary class="small">Add a note</summary><textarea data-incnote="${esc(inc.id)}" data-round="${roundIndex}" maxlength="600" style="min-height:70px" placeholder="What exactly did they do or say?">${esc(rt.note || '')}</textarea><button class="btn btn-sm" style="margin-top:.4rem" data-a="saveIncNote" data-id="${esc(inc.id)}" data-round="${roundIndex}">Save note</button></details></div>`;
}
function justLoggedBar() {
  if (!lastLogged) return '';
  const o = S.round.observations.find(x => x.id === lastLogged.id); if (!o) return '';
  const bare = o.flagged && !o.tagId && !o.text;
  return `<div class="justlogged ${o.flagged ? 'flagged' : ''}"><div class="grow"><b>${bare ? '⚑ Moment flagged' : (o.flagged ? '⚑ ' : '✓ ') + esc(obsLabel(o))}</b> <span class="jl-time">at ${mmss(o.elapsed)} · ${clockOf(o.time)}</span>
    <div class="small">${bare ? 'Tap an item below to say what it was, or fill it in later in Review.' : o.flagged ? 'Flagged to fill in later in Review.' : 'Saved.'}</div></div>
    <div class="row nowrap">${bare ? '' : `<button class="btn btn-sm" data-a="obsFlag" data-id="${esc(o.id)}" aria-pressed="${o.flagged}">${o.flagged ? 'Unflag' : '⚑ Flag'}</button>`}<button class="btn btn-sm" data-a="editObs" data-id="${esc(o.id)}" aria-label="Add detail">✎</button><button class="btn btn-sm btn-danger" data-a="obsDelQuick" data-id="${esc(o.id)}">Delete</button><button class="btn btn-sm btn-quiet" style="color:#fff" data-a="jlClose" aria-label="Hide">✕</button></div></div>`;
}
function viewObserve() {
  const r = S.round;
  const incs = r.incidents.filter(i => i.status === 'active' || (i.status === 'resolved' && !ratingDone(i)));
  const support = evalTarget === 'support';
  const tags = S.quickTags.filter(t => t.target === evalTarget);
  const counts = {}; r.observations.forEach(o => { if (o.tagId) counts[o.tagId] = (counts[o.tagId] || 0) + 1; });
  const areas = [...new Set(tags.map(t => t.competency))];
  const shown = tagFilter === 'all' || !areas.includes(tagFilter) ? areas : [tagFilter];
  const list = r.observations.slice().reverse();
  const flaggedN = r.observations.filter(o => o.flagged).length;
  return `<div class="page-title"><h1>Observe</h1><p>Tap what you see. Every entry keeps its time. Flag anything to come back to.</p></div>
  <div class="cols cols-main"><div class="stack">
    <div class="target-switch"><button class="${!support ? 'on' : ''}" data-a="target" data-v="lead"><small>★ Lead · scored</small><b>${esc(r.leadName || 'Not chosen yet')}</b></button><button class="support ${support ? 'on' : ''}" data-a="target" data-v="support"><small>◇ Support</small><b>${esc(r.supportName || 'Not chosen yet')}</b></button></div>
    ${incs.length && !support ? `<section><h3 style="margin-bottom:.5rem">Cards to rate (${incs.length})</h3>${incs.map(i => rateBlock(i, r.index)).join('')}</section>` : ''}
    <div class="quick-actions"><div role="button" tabindex="0" class="btn btn-lg flagbtn" data-a="flag">${HAPT}⚑ Flag this moment</div><button class="btn btn-lg" data-a="note">✎ Write a note</button></div>
    <section class="card card-tight"><div class="pills">${['all', ...areas].map(a => `<button class="${(tagFilter === a || (a === 'all' && !areas.includes(tagFilter))) ? 'on' : ''}" data-a="tagfilter" data-v="${esc(a)}">${esc(a === 'all' ? 'All' : AREA_SHORT[a] || a)}</button>`).join('')}</div>
      ${shown.map(a => `<div class="tag-group"><h4>${esc(a)}</h4><div class="tags">${tags.filter(t => t.competency === a).map(t => `<div role="button" tabindex="0" class="tag ${t.polarity === '+' ? 'plus' : 'minus'}" data-a="tag" data-id="${esc(t.id)}">${HAPT}<span class="pm" aria-label="${t.polarity === '+' ? 'strength' : 'to improve'}">${t.polarity === '+' ? '+' : '−'}</span><span>${esc(t.short)}</span>${counts[t.id] ? `<span class="cnt">${counts[t.id]}</span>` : ''}</div>`).join('')}</div></div>`).join('')}
    </section>
  </div><div class="stack">
    <section class="card"><div class="card-head"><h3>Log</h3><span>${chip(r.observations.length + ' entries', 'info')} ${flaggedN ? chip('⚑ ' + flaggedN + ' flagged', 'warn') : ''}</span></div>
      <p class="small muted" style="margin-top:0">Lesson time on the left, clock time under it. Notes from every evaluator appear here.</p>
      ${list.length ? list.slice(0, 12).map(o => obsRow(o)).join('') : '<div class="empty">Nothing logged yet.</div>'}
      ${list.length > 12 ? `<button class="btn btn-sm btn-block" style="margin-top:.5rem" data-a="nav" data-v="review">See all ${list.length} in Review ›</button>` : ''}</section>
  </div></div>
  ${justLoggedBar()}`;
}
function obsLabel(o) { const t = o.tagId ? S.quickTags.find(x => x.id === o.tagId) : null; return t ? t.short : o.flagged && !o.text ? 'Flagged moment' : (o.text || 'Note'); }
function obsRow(o, roundIndex) {
  const ri = roundIndex ?? S.round.index;
  const t = o.tagId ? S.quickTags.find(x => x.id === o.tagId) : null;
  const title = t ? t.short : o.flagged && !o.text ? 'Flagged moment (add details)' : (AREA_SHORT[o.competency] || o.competency);
  return `<div class="obs ${o.flagged ? 'is-flagged' : ''}"><span class="when"><b>${o.elapsed == null ? 'after' : mmss(o.elapsed)}</b><small>${clockOf(o.time)}</small></span><span class="pm ${o.polarity === '+' ? 'plus' : o.polarity === '-' ? 'minus' : ''}">${o.polarity === '+' ? '+' : o.polarity === '-' ? '−' : '•'}</span><div class="grow"><b>${esc(title)}</b>${o.text ? `<div class="small">${esc(o.text)}</div>` : ''}<div class="xs muted">${esc(AREA_SHORT[o.competency] || o.competency)}${o.target === 'support' ? ' · Support' : ''} · ${esc(o.by)}</div></div>
    <div class="obs-actions"><button class="ib ${o.flagged ? 'on' : ''}" data-a="obsFlag" data-id="${esc(o.id)}" data-round="${ri}" aria-label="${o.flagged ? 'Unflag' : 'Flag for later'}" aria-pressed="${o.flagged}">⚑</button><button class="ib" data-a="editObs" data-id="${esc(o.id)}" data-round="${ri}" aria-label="Edit">✎</button><button class="ib" data-a="delObs" data-id="${esc(o.id)}" data-round="${ri}" aria-label="Delete">✕</button></div></div>`;
}
function noteSheet(o, roundIndex) {
  const areas = [...S.rubric, 'Support Trainer', 'General'];
  const comp = o ? o.competency : evalTarget === 'support' ? 'Support Trainer' : 'General';
  const t = o?.tagId ? S.quickTags.find(x => x.id === o.tagId) : null;
  const live = S.round.status !== 'lobby' && (roundIndex == null || roundIndex === S.round.index);
  const startedAt = !o && live ? Math.floor(elapsedNow()) : null;
  const when = o ? (o.elapsed == null ? 'Added after the lesson' : `At ${mmss(o.elapsed)} · ${clockOf(o.time)}`) : startedAt != null ? `At ${mmss(startedAt)} · ${clockOf(Date.now())} (kept even if you take a while to type)` : 'Added outside lesson time';
  modal(`<h2>${o ? (t ? esc(t.short) : 'Edit note') : 'Write a note'}</h2><p class="small muted" style="margin-top:0">⏱ ${esc(when)}${o ? ' · by ' + esc(o.by) : ''}</p>
    <form id="note-form" data-id="${esc(o?.id || '')}" data-round="${roundIndex ?? S.round.index}" data-at="${startedAt ?? ''}">
    <div class="field"><label class="lbl" for="n-text">${t ? 'Add detail (optional)' : 'What happened?'}</label><textarea id="n-text" name="text" maxlength="1000" autofocus placeholder="Describe what you saw or heard.">${esc(o?.text || '')}</textarea></div>
    ${t ? '' : `<div class="field"><label class="lbl" for="n-area">Area</label><select id="n-area" name="competency">${areas.map(a => `<option ${a === comp ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
    <div class="field"><span class="lbl">Type</span><div class="seg compact">${[['+', '+ Strength'], ['-', '− To improve'], ['', 'Neutral']].map(([v, l]) => `<label style="flex:1"><input type="radio" name="polarity" value="${v}" ${(o?.polarity ?? '') === v ? 'checked' : ''} class="sr"><span class="btn btn-sm btn-block ${(o?.polarity ?? '') === v ? 'btn-primary' : ''}" data-radio>${l}</span></label>`).join('')}</div></div>`}
    <label class="toggle-row"><span>⚑ Flag to fill in later</span><span class="switch"><input type="checkbox" name="flagged" ${o?.flagged ? 'checked' : ''}><span></span></span></label>
    <div class="row" style="margin-top:1rem">${o ? `<button type="button" class="btn btn-danger" data-a="delObs" data-id="${esc(o.id)}" data-round="${roundIndex ?? S.round.index}">Delete</button>` : ''}<button type="button" class="btn grow" data-a="close">Cancel</button><button type="submit" class="btn btn-primary grow">Save</button></div></form>`);
}

// ---------- review ----------
function roundForReview() {
  const idx = reviewIndex ?? S.round.index;
  if (idx === S.round.index) return S.round;
  if (!archived) { loadArchived(); return null; }
  return archived.find(x => x.index === idx) || S.round;
}
async function loadArchived() {
  if (archivedLoading) return; archivedLoading = true;
  try { archived = await sess.rounds(); } catch (e) { toast(e.message, true); archived = []; }
  archivedLoading = false; render(true);
}
function draftKey(r) { return `cs_draft_${S.code}_${r.index}`; }
function getDraft(r) {
  const d = load(draftKey(r), null);
  if (d && d.dirty) return d;
  return { scores: { ...r.scores }, leadNotes: r.leadNotes || '', supportNotes: r.supportNotes || '', decision: r.decision || 'pending', dirty: false };
}
function setDraft(r, patch) { const d = { ...getDraft(r), ...patch, dirty: true }; save(draftKey(r), d); return d; }
function viewReview() {
  const r = roundForReview();
  if (!r) return '<div class="empty">Loading round…</div>';
  const idx = r.index, d = getDraft(r);
  const leadObs = r.observations.filter(o => o.target !== 'support'), supObs = r.observations.filter(o => o.target === 'support');
  const flagged = r.observations.filter(o => o.flagged);
  const incs = r.incidents.filter(i => i.status !== 'cancelled');
  const rated = incs.filter(ratingDone).length;
  const scored = S.rubric.filter(k => d.scores[k] && d.scores[k] !== 'not-observed').length;
  const checks = [
    [rated === incs.length, `Scenario cards rated (${rated}/${incs.length})`],
    [flagged.length === 0, flagged.length ? `${flagged.length} flagged moment${flagged.length > 1 ? 's' : ''} to fill in` : 'No flagged moments left'],
    [scored === S.rubric.length, `Areas scored (${scored}/${S.rubric.length})`],
    [d.leadNotes.trim().length > 20, 'Lead Trainer feedback written'],
    [d.decision !== 'pending', 'Outcome chosen']
  ];
  const roundsAvail = [...(S.archivedRounds || []).map(a => a.index), S.round.index];
  return `<div class="page-title"><h1>Review round ${idx}</h1><p>Lead: <b>${esc(r.leadName || '—')}</b> · Support: <b>${esc(r.supportName || '—')}</b>${r.savedAt ? ` · last saved by ${esc(r.savedBy)} at ${clockOf(r.savedAt)}` : ''}</p></div>
  ${roundsAvail.length > 1 ? `<div class="pills">${roundsAvail.slice().reverse().map(i => `<button class="${i === idx ? 'on' : ''}" data-a="reviewRound" data-v="${i}">Round ${i}${i === S.round.index ? ' (now)' : ''}</button>`).join('')}</div>` : ''}
  <div class="cols cols-main"><div class="stack">
    <section class="card raised checklist"><h3>Before you finish</h3>${checks.map(([ok, t]) => `<div class="${ok ? 'ok' : ''}"><span class="ck">${ok ? '✓' : '!'}</span><span>${esc(t)}</span></div>`).join('')}</section>
    ${flagged.length ? `<section class="card"><h3>⚑ Flagged moments</h3><p class="small muted">You flagged these during the lesson. Describe what happened, then tap Done.</p>${flagged.map(o => `<div class="rate-card todo"><div class="row between"><b>At ${mmss(o.elapsed)} · ${clockOf(o.time)}</b><span class="xs muted">${esc(o.by)}${o.incidentIds?.length ? ' · during: ' + esc(o.incidentIds.map(id => r.incidents.find(i => i.id === id)?.title).filter(Boolean).join(', ')) : ''}</span></div>
      ${o.tagId ? `<p style="margin:.3rem 0"><b>${esc(obsLabel(o))}</b></p>` : ''}
      <textarea data-flagtext="${esc(o.id)}" maxlength="1000" placeholder="What happened?" style="margin-top:.4rem">${esc(o.text)}</textarea>
      <div class="row" style="margin-top:.4rem">${o.tagId ? '' : `<select data-flagarea="${esc(o.id)}" class="grow" style="min-width:160px">${[...S.rubric, 'Support Trainer', 'General'].map(a => `<option ${a === o.competency ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>${seg('flagpol-' + o.id, [['+', '+', 'good'], ['-', '−', 'warn']], o.polarity, `data-flagpol="${esc(o.id)}"`, true)}`}<button class="btn btn-primary btn-sm" data-a="flagDone" data-id="${esc(o.id)}" data-round="${idx}" data-tagged="${o.tagId ? 1 : ''}">Done</button></div></div>`).join('')}</section>` : ''}
    ${incs.length ? `<section class="card"><h3>Scenario card ratings</h3>${incs.map(i => rateBlock(i, idx)).join('')}</section>` : ''}
    <section class="card"><h3>Lead Trainer scores</h3><p class="small muted">Your notes for each area are listed to help you decide. The app never scores for you. “Not seen” is not a fail.</p>
      ${S.rubric.map(k => { const ev = leadObs.filter(o => o.competency === k), plus = ev.filter(o => o.polarity === '+').length, minus = ev.filter(o => o.polarity === '-').length; return `<div class="rubric-item"><div class="row between"><b>${esc(k)}</b><span>${plus ? chip('+' + plus, 'good') : ''} ${minus ? chip('−' + minus, 'warn') : ''}</span></div>${ev.length ? `<div class="ev">${ev.map(o => `${o.polarity === '+' ? '＋' : o.polarity === '-' ? '－' : '•'} ${mmss(o.elapsed)} ${esc(obsLabel(o))}${o.tagId && o.text ? ': ' + esc(o.text) : ''}`).join('<br>')}</div>` : '<div class="ev">No notes logged for this area.</div>'}${seg('score', SCORE_LABELS, d.scores[k] || 'not-observed', `data-k="${esc(k)}" data-round="${idx}"`, true)}</div>`; }).join('')}</section>
  </div><div class="stack">
    <section class="card"><div class="card-head"><h3>Lead Trainer feedback</h3><button class="btn btn-sm btn-primary" data-a="draft" data-v="lead" data-round="${idx}">✨ Draft from notes</button></div>
      <textarea data-draft="leadNotes" data-round="${idx}" style="min-height:220px" placeholder="Strengths, areas to develop, and the reason for your scores.">${esc(d.leadNotes)}</textarea></section>
    <section class="card"><div class="card-head"><h3>Support Trainer feedback</h3><button class="btn btn-sm" data-a="draft" data-v="support" data-round="${idx}">✨ Draft</button></div><p class="small muted">Developmental only. Not scored.</p>
      <textarea data-draft="supportNotes" data-round="${idx}" style="min-height:140px">${esc(d.supportNotes)}</textarea>
      ${supObs.length ? `<details style="margin-top:.4rem"><summary class="small">${supObs.length} support note${supObs.length > 1 ? 's' : ''}</summary>${supObs.map(o => obsRow(o, idx)).join('')}</details>` : ''}</section>
    <section class="card"><h3>Outcome</h3><p class="small muted">Your decision as the assessor.</p>${seg('decision', OUTCOMES.map(([v, l]) => [v, l, v === 'competent' ? 'good' : v === 'not-yet-competent' ? 'bad' : '']), d.decision, `data-round="${idx}"`)}
      ${(r.assessLog || []).length ? `<details style="margin-top:.6rem"><summary class="small">Change history (${r.assessLog.length} save${r.assessLog.length > 1 ? 's' : ''})</summary><div class="log">${r.assessLog.slice().reverse().map(x => `<div>${new Date(x.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · <b>${esc(x.by)}</b> · ${esc({ pending: 'Not decided', competent: 'Competent', 'not-yet-competent': 'Not yet competent' }[x.decision] || x.decision)}</div>`).join('')}</div></details>` : ''}</section>
    <section class="card"><details><summary>All notes for this round (${r.observations.length})</summary>${r.observations.slice().sort((a, b) => (a.elapsed ?? 1e12) - (b.elapsed ?? 1e12)).map(o => obsRow(o, idx)).join('') || '<p class="muted">None.</p>'}<button class="btn btn-sm" style="margin-top:.5rem" data-a="note-after" data-round="${idx}">+ Add a note</button></details></section>
  </div></div>
  <div class="savebar"><span class="grow">${d.dirty ? '● Unsaved changes on this device' : '✓ All changes saved'}</span><button class="btn ${d.dirty ? 'btn-primary' : ''}" data-a="saveAssess" data-round="${idx}">Save</button></div>`;
}
function draftText(r, target) {
  const obs = r.observations.filter(o => (target === 'support') === (o.target === 'support'));
  const name = (target === 'support' ? r.supportName : r.leadName) || (target === 'support' ? 'The Support Trainer' : 'The Lead Trainer');
  const first = name.split(' ')[0];
  const group = pol => {
    const out = new Map();
    for (const o of obs.filter(o => o.polarity === pol)) {
      const t = o.tagId ? S.quickTags.find(x => x.id === o.tagId) : null;
      const key = t ? t.id : o.id;
      const cur = out.get(key) || { text: t ? t.detail : o.text, times: [], extras: [] };
      if (o.elapsed != null) cur.times.push(mmss(o.elapsed));
      if (t && o.text) cur.extras.push(o.text);
      out.set(key, cur);
    }
    return [...out.values()].filter(g => g.text).map(g => `- ${g.text.charAt(0).toUpperCase() + g.text.slice(1)}${g.times.length ? ` (at ${g.times.join(', ')})` : ''}${g.extras.length ? `: ${g.extras.join('; ')}` : ''}.`);
  };
  const strengths = group('+'), develop = group('-');
  const neutral = obs.filter(o => !o.polarity && o.text).map(o => `- ${o.text}${o.elapsed != null ? ` (at ${mmss(o.elapsed)})` : ''}`);
  const lines = [`Strengths\n${strengths.length ? strengths.join('\n') : '- (none logged)'}`, `Areas to develop\n${develop.length ? develop.join('\n') : '- (none logged)'}`];
  if (target === 'lead') {
    const rated = r.incidents.filter(i => i.status !== 'cancelled' && i.rating && (i.rating.noticed || i.rating.response));
    if (rated.length) lines.push(`Handling of classroom situations\n${rated.map(i => `- ${i.title} (${i.color} learner, ${mmss(i.triggerElapsedMs)}): ${[i.rating.noticed, i.rating.response].filter(Boolean).map(x => RATE_WORDS[x]).join(', ')}${i.rating.handledBy ? ', ' + RATE_WORDS[i.rating.handledBy] : ''}.${i.rating.note ? ' ' + i.rating.note : ''}`).join('\n')}`);
  }
  if (neutral.length) lines.push(`Other notes\n${neutral.join('\n')}`);
  lines.push(target === 'lead' ? `Next step for ${first}: ` : `Suggestion for ${first}: `);
  return lines.join('\n\n');
}

// ---------- records ----------
function viewRecords() {
  const rounds = [...(S.archivedRounds || []), { index: S.round.index, leadName: S.round.leadName, supportName: S.round.supportName, decision: S.round.decision, observations: S.round.observations.length, current: true }];
  const word = d => ({ pending: 'Not decided', competent: 'Competent', 'not-yet-competent': 'Not yet competent' }[d] || d);
  return `<div class="page-title"><h1>Records</h1><p>${esc(S.cohort)} · ${esc(S.lessonTopic)} · ${S.mode === 'assessment' ? 'Assessment' : 'Practice'} mode</p></div>
  <div class="stack">
    <section class="card"><h3>Rounds</h3><div class="tablewrap"><table class="tbl"><thead><tr><th>#</th><th>Lead Trainer</th><th>Support</th><th>Outcome</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rounds.slice().reverse().map(x => `<tr><td>${x.index}${x.current ? ' <span class="xs muted">(now)</span>' : ''}</td><td>${esc(x.leadName || '—')}</td><td>${esc(x.supportName || '—')}</td><td>${chip(word(x.decision), x.decision === 'competent' ? 'good' : x.decision === 'not-yet-competent' ? 'bad' : '')}</td><td>${x.observations}</td><td><button class="btn btn-sm" data-a="reviewRound" data-v="${x.index}" data-go="1">Review</button></td></tr>`).join('')}
    </tbody></table></div></section>
    <div class="cols cols-2">
      <section class="card"><h3>Printable report</h3><p class="small muted">Scores, card ratings, all notes and written feedback for every round. Use “Save as PDF” in the print window.</p><button class="btn btn-primary" data-a="report">🖨 Print / Save as PDF</button></section>
      <section class="card"><h3>Download data</h3><p class="small muted">Spreadsheet (CSV) of all events, notes and ratings, or a full JSON backup.</p><div class="row"><button class="btn" data-a="export" data-v="csv">⤓ CSV</button><button class="btn" data-a="export" data-v="json">⤓ JSON</button></div></section>
    </div>
    <p class="note small">The 6 rubric areas and 1–4 scale are a draft. Map them to the course's approved assessment criteria before formal use.</p>
  </div>`;
}
async function printReport() {
  let data; try { data = await sess.exportData(); } catch (e) { return toast(e.message, true); }
  const sc = { 'not-observed': 'Not seen', 1: '1 Emerging', 2: '2 Developing', 3: '3 Competent', 4: '4 Proficient' };
  const pn = id => data.participants.find(p => p.id === id)?.name || '—';
  $('#print-area').innerHTML = `<h1>ClassroomSim assessment report</h1><p><b>Cohort:</b> ${esc(data.session.cohort)} · <b>Topic:</b> ${esc(data.session.lessonTopic)} · <b>Mode:</b> ${esc(data.session.mode)} · <b>Session:</b> ${esc(data.session.code)} · <b>Printed:</b> ${new Date().toLocaleString()}</p>
  ${data.rounds.map(r => `<h2>Round ${r.index}: ${esc(r.leadName || pn(r.leadId))} (Lead)</h2><p><b>Support Trainer:</b> ${esc(r.supportName || pn(r.supportId))} · <b>Outcome:</b> ${esc({ pending: 'Not decided', competent: 'Competent', 'not-yet-competent': 'Not yet competent' }[r.decision])}${r.savedBy ? ` · <b>Assessed by:</b> ${esc(r.savedBy)}` : ''}</p>
    <h3>Scores</h3><table>${Object.entries(r.scores).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(sc[v] || v)}</td></tr>`).join('')}</table>
    <h3>Lead Trainer feedback</h3><pre>${esc(r.leadNotes || 'Not recorded')}</pre><h3>Support Trainer feedback (developmental)</h3><pre>${esc(r.supportNotes || 'Not recorded')}</pre>
    <h3>Scenario cards</h3>${r.incidents.filter(i => i.status !== 'cancelled').length ? `<table><tr><th>Time</th><th>Card</th><th>Noticed</th><th>Response</th><th>Handled by</th><th>Note</th></tr>${r.incidents.filter(i => i.status !== 'cancelled').map(i => `<tr><td>${mmss(i.triggerElapsedMs)}</td><td>${esc(i.title)} (${esc(i.color)})</td><td>${esc(i.rating?.noticed || '–')}</td><td>${esc(i.rating?.response || '–')}</td><td>${esc(i.rating?.handledBy || '–')}</td><td>${esc(i.rating?.note || '')}</td></tr>`).join('')}</table>` : '<p>None.</p>'}
    <h3>Observation notes</h3>${r.observations.length ? `<table>${r.observations.slice().sort((a, b) => (a.elapsed ?? 1e12) - (b.elapsed ?? 1e12)).map(o => { const t = o.tagId && S.quickTags.find(x => x.id === o.tagId); return `<tr><td>${o.elapsed == null ? 'after' : mmss(o.elapsed)}</td><td>${o.polarity === '+' ? '+' : o.polarity === '-' ? '−' : ''}</td><td>${esc(o.competency)}${o.target === 'support' ? ' (Support)' : ''}</td><td>${esc([t?.short, o.text].filter(Boolean).join(': '))}</td><td>${esc(o.by)}</td></tr>`; }).join('')}</table>` : '<p>None.</p>'}`).join('') || '<p>No rounds yet.</p>'}
  <p style="font-size:11px;color:#666;margin-top:20px">Rubric areas are provisional. Final competency decisions rest with the authorised assessor.</p>`;
  setTimeout(() => window.print(), 50);
}
async function download(type) {
  try {
    const text = type === 'csv' ? await sess.exportCsv() : JSON.stringify(await sess.exportData(), null, 2);
    const blob = new Blob([text], { type: type === 'csv' ? 'text/csv' : 'application/json' });
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = `ClassroomSim_${S.code}.${type}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  } catch (e) { toast(e.message, true); }
}

// ---------- settings ----------
function settingsSheet() {
  const sw = (k, label, hint) => `<label class="toggle-row"><span><b>${label}</b>${hint ? `<br><span class="small muted">${hint}</span>` : ''}</span><span class="switch"><input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''}><span></span></span></label>`;
  modal(`<h2>Settings</h2>
    <div class="field"><span class="lbl">Text size</span>${seg('textsize', [[0, 'A'], [1, 'A+'], [2, 'A++']], prefs.text)}</div>
    ${sw('vibrate', 'Vibrate', canVibrate() ? 'Buzz when something needs your attention.' : 'iPhones only allow a light tap. The sound and screen flash still work.')}
    ${sw('sound', 'Sound', 'A short chime with each alert.')}
    ${sw('wake', 'Keep screen on', 'Stops the phone sleeping during a session.')}
    <div class="row" style="margin-top:1rem"><button class="btn grow" data-a="test-alert">🔔 Test alert</button></div>
    ${identity?.kind === 'staff' ? `<div class="divider"></div><button class="btn btn-primary btn-block" data-a="switchSession">Switch to another session or start a new one</button><p class="hint">This session keeps running. You can come back to it from "Your sessions on this device".</p>` : ''}
    ${identity ? `<div class="divider"></div><p class="small muted">In session <b>${esc(identity.code)}</b> as ${esc(S?.me?.name || identity.kind)}.</p><button class="btn btn-danger btn-block" data-a="leave">Leave session on this device</button>` : ''}
    <button class="btn btn-block" style="margin-top:.7rem" data-a="close">Close</button>`);
}

// ---------------- events ----------------
document.addEventListener('click', async e => {
  const radio = e.target.closest('[data-radio]');
  if (radio) { const lab = radio.closest('label'); const form = lab.closest('form'); lab.querySelector('input').checked = true; form.querySelectorAll('[data-radio]').forEach(x => x.classList.toggle('btn-primary', x === radio)); e.preventDefault(); return; }
  const sb = e.target.closest('[data-seg]');
  if (sb && !sb.disabled) return onSeg(sb);
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a, id = el.dataset.id, ri = Number(el.dataset.round) || undefined;
  if (a === 'modal-bg') { if (e.target === el) closeModal(); return; }
  switch (a) {
    case 'cf-yes': { const r = modalRoot._resolve; modalRoot._onClose = null; closeModal(); r?.(true); return; }
    case 'cf-no': case 'close': closeModal(); return;
    case 'retry': bootError = null; boot(); return;
    case 'land': landing = el.dataset.to; if (landing === 'home') { try { history.replaceState(null, '', location.pathname); } catch {} } render(true); return;
    case 'staffTab': staffTab = el.dataset.v; render(true); return;
    case 'settings': settingsSheet(); return;
    case 'test-alert': unlockAlerts(); notify('scenario', 'This is what an alert feels like'); return;
    case 'enable-alerts': unlockAlerts(); notify('role', 'Alerts are on'); render(true); return;
    case 'leave': closeModal(); if (await confirmBox('Leave this session on this device?', 'Leave', true)) { if (identity?.kind === 'staff') forgetSession(identity.code); if (identity?.kind === 'participant') await sess?.leave?.(); signOut(); } return;
    case 'leave-now': signOut(true); return;
    case 'undo': { const u = lastToastUndo; toastEl.className = 'toast'; if (u) await u(); return; }
    case 'nav': view = el.dataset.v; if (view === 'review') reviewIndex = null; render(true); window.scrollTo(0, 0); return;
    case 'copy': { const link = el.dataset.link === 'evalinvite' ? `${joinUrl('eval')}#k=${S.evaluatorPin}` : joinUrl('join'); try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link); } return; }
    case 'showQR': showQR(); return;
    case 'sendfilter': sendFilter = el.dataset.v; render(true); return;
    case 'openSession': { try { await getStore(); startSession({ code: el.dataset.v, kind: 'staff' }); } catch (err) { toast(err.message, true); } return; }
    case 'forgetSession': forgetSession(el.dataset.v); render(true); return;
    case 'switchSession': closeModal(); sess?.stop(); sess = null; identity = null; S = null; archived = null; view = null; save('cs_identity', null); landing = 'staff'; staffTab = 'new'; render(true); window.scrollTo(0, 0); return;
    case 'openStep': openStep = Number(el.dataset.v); render(true); return;
    case 'preview': previewSheet(id, el.dataset.pid); return;
    case 'sendNow': closeModal(); return cmd('trigger', { scenarioId: id, participantId: el.dataset.pid }, `Card dealt to ${pname(el.dataset.pid)}`);
    case 'setTrainers': openStep = null; return cmd('setTrainers', { leadId: $('#lead-sel').value, supportId: $('#sup-sel').value }, 'Trainers set');
    case 'assignRoles': openStep = null; return cmd('assignRoles', {}, 'Role cards dealt');
    case 'planDefault': return cmd('planDefault', {}, 'New timeline made');
    case 'removePlan': return cmd('removePlan', { planId: id });
    case 'removeParticipant': if (await confirmBox('Remove this person? Role cards will need to be dealt again.', 'Remove', true)) cmd('removeParticipant', { participantId: id }); return;
    case 'removeEvaluator': if (await confirmBox('Remove this evaluator? They lose access straight away, and the evaluator code changes so they cannot rejoin.', 'Remove', true)) cmd('removeEvaluator', { evaluatorId: id }, 'Removed. New evaluator code made.'); return;
    case 'newPin': if (await confirmBox('Make a new evaluator code? Evaluators already in stay in. The old code stops working for anyone new.', 'New code')) cmd('newPin', {}, 'New evaluator code ready'); return;
    case 'start': { unlockAlerts(); const ok = await cmd('start', {}, 'Round started'); if (ok) { view = 'run'; render(true); window.scrollTo(0, 0); } return; }
    case 'pause': return cmd('pause');
    case 'resume': return cmd('resume');
    case 'end': if (await confirmBox('End this round now?', 'End round', true)) cmd('end'); return;
    case 'nextRound': if (await confirmBox('Start the next round? This one is saved and the trainers rotate.', 'Next round')) { const ok = await cmd('nextRound', {}, 'Next round ready'); if (ok) { view = 'setup'; render(true); } } return;
    case 'resolve': case 'cancel': return cmd(a, { instanceId: id });
    case 'tagfilter': tagFilter = el.dataset.v; render(true); return;
    case 'target': evalTarget = el.dataset.v; tagFilter = 'all'; render(true); return;
    case 'tag': {
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      tapBuzz();
      try {
        if (lastLogged && lastLogged.bareFlag && Date.now() - lastLogged.at < 45000 && S.round.observations.some(o => o.id === lastLogged.id)) {
          await sess.command({ action: 'editObservation', id: lastLogged.id, tagId: id });
          lastLogged = { id: lastLogged.id, at: Date.now() };
        } else {
          const res = await sess.command({ action: 'observe', tagId: id });
          lastLogged = { id: res.observationId, at: Date.now() };
        }
        render(true);
      } catch (err) { toast(err.message, true); }
      return;
    }
    case 'flag': tapBuzz(); try { const res = await sess.command({ action: 'observe', flagged: true, target: evalTarget }); lastLogged = { id: res.observationId, at: Date.now(), bareFlag: true }; render(true); } catch (err) { toast(err.message, true); } return;
    case 'note': noteSheet(null); return;
    case 'note-after': noteSheet(null, ri); return;
    case 'editObs': { const r = ri && ri !== S.round.index ? archived?.find(x => x.index === ri) : S.round; const o = r?.observations.find(x => x.id === id); if (o) noteSheet(o, ri); return; }
    case 'obsFlag': { const r = ri && ri !== S.round.index ? archived?.find(x => x.index === ri) : S.round; const o = r?.observations.find(x => x.id === id); if (!o) return; await cmd('editObservation', { id, flagged: !o.flagged, roundIndex: ri }, lastLogged?.id === id ? null : (o.flagged ? 'Unflagged' : '⚑ Flagged for later')); if (ri && ri !== S.round.index) loadArchived(); return; }
    case 'obsDelQuick': lastLogged = null; return cmd('deleteObservation', { id }, 'Deleted');
    case 'jlClose': lastLogged = null; render(true); return;
    case 'delObs': closeModal(); if (await confirmBox('Delete this note?', 'Delete', true)) { await cmd('deleteObservation', { id, roundIndex: ri }, 'Deleted'); if (ri && ri !== S.round.index) loadArchived(); } return;
    case 'flagDone': {
      const text = document.querySelector(`[data-flagtext="${CSS.escape(id)}"]`)?.value || '';
      const payload = { id, text, flagged: false, roundIndex: ri };
      if (!el.dataset.tagged) { payload.competency = document.querySelector(`[data-flagarea="${CSS.escape(id)}"]`)?.value; payload.polarity = document.querySelector(`[data-flagpol="${CSS.escape(id)}"].on`)?.dataset.v || ''; if (!text.trim()) return toast('Describe what happened first.', true); }
      await cmd('editObservation', payload, 'Saved'); if (ri && ri !== S.round.index) loadArchived(); return;
    }
    case 'saveIncNote': { const note = document.querySelector(`[data-incnote="${CSS.escape(id)}"]`)?.value || ''; await cmd('rateIncident', { instanceId: id, note, roundIndex: ri }, 'Note saved'); if (ri && ri !== S.round.index) loadArchived(); return; }
    case 'reviewRound': reviewIndex = Number(el.dataset.v); if (el.dataset.go) view = 'review'; if (reviewIndex !== S.round.index && !archived) loadArchived(); render(true); window.scrollTo(0, 0); return;
    case 'draft': {
      const r = roundForReview(); if (!r) return;
      const field = el.dataset.v === 'support' ? 'supportNotes' : 'leadNotes';
      if (getDraft(r)[field].trim() && !(await confirmBox('Replace what you have written with a fresh draft from your notes?', 'Replace'))) return;
      setDraft(r, { [field]: draftText(r, el.dataset.v) }); render(true); toast('Draft ready. Edit it to add your judgement.'); return;
    }
    case 'saveAssess': {
      const r = roundForReview(); if (!r) return; const d = getDraft(r);
      const ok = await cmd('assess', { scores: d.scores, leadNotes: d.leadNotes, supportNotes: d.supportNotes, decision: d.decision, roundIndex: r.index }, 'Saved');
      if (ok) { save(draftKey(r), null); if (r.index !== S.round.index) loadArchived(); else render(true); }
      return;
    }
    case 'report': return printReport();
    case 'export': return download(el.dataset.v);
    // participant cards
    case 'flip': { tapBuzz(); const now = !el.classList.contains('is-flipped'); el.classList.toggle('is-flipped', now); setFlipped(id, now); unlockAlerts(); setTimeout(() => render(true), 760); return; }
    case 'flip-new': {
      if (el.classList.contains('is-flipped')) return;
      tapBuzz(); el.classList.remove('deal'); el.classList.add('is-flipped'); unlockAlerts(); setFlipped(id, true);
      sess.acknowledge(id).catch(err => toast(err.message, true));
      const hint = document.getElementById('felt-hint');
      if (hint) hint.outerHTML = `<button class="btn btn-primary btn-lg" data-a="felt-close" style="width:min(84vw,340px)">Got it, I'll do it now</button>`;
      return;
    }
    case 'felt-close': document.getElementById('table-felt')?.remove(); render(true); return;
    case 'flip-sc': return; // the card in play stays face up
    case 'intervened': setFlipped('appr-' + id, true); try { await sess.approached(id); toast('Thanks. The evaluators can see a trainer came to you.'); } catch (err) { toast(err.message, true); } render(true); return;
  }
});

async function onSeg(btn) {
  const name = btn.dataset.seg, v = btn.dataset.v, ri = Number(btn.dataset.round) || undefined;
  const group = btn.parentElement;
  const markOn = () => group.querySelectorAll('button').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  if (name === 'c-dur') { createDraft.dur = Number(v); markOn(); return; }
  if (name === 'c-mode') { createDraft.mode = v; markOn(); const h = $('#mode-hint'); if (h) h.textContent = MODE_HINT[v]; return; }
  if (name === 'textsize') { prefs.text = Number(v); save('cs_prefs', prefs); document.documentElement.dataset.text = v; markOn(); return; }
  if (name === 'phase') return cmd('activity', { phase: v });
  if (name === 'percolour') return cmd('setPerColour', { perColour: Number(v) }, 'Updated');
  if (name === 'automode') return cmd('setAutoPrompts', { on: v === 'auto' }, v === 'auto' ? 'Automatic timeline on' : 'Manual dealing only');
  if (name === 'duration') return cmd('setDuration', { durationMinutes: Number(v) });
  if (name === 'rate') {
    markOn(); const tone = RATE[btn.dataset.field].opts.find(o => o[0] === v)?.[2]; if (tone) btn.classList.add(tone);
    await cmd('rateIncident', { instanceId: btn.dataset.inc, [btn.dataset.field]: v, roundIndex: ri });
    if (ri && ri !== S.round.index) loadArchived();
    return;
  }
  if (name === 'score' || name === 'decision') {
    const r = roundForReview(); if (!r) return; const d = getDraft(r);
    if (name === 'score') setDraft(r, { scores: { ...d.scores, [btn.dataset.k]: v } }); else setDraft(r, { decision: v });
    render(true); return;
  }
  if (name.startsWith('flagpol-')) { markOn(); btn.classList.add(v === '+' ? 'good' : 'warn'); }
}
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-a]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.draft) { const r = roundForReview(); if (r) { setDraft(r, { [t.dataset.draft]: t.value }); const sb = document.querySelector('.savebar .grow'); if (sb) sb.textContent = '● Unsaved changes on this device'; } }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.pref) { prefs[t.dataset.pref] = t.checked; save('cs_prefs', prefs); if (t.dataset.pref === 'wake') t.checked ? requestWake() : releaseWake(); }
});
document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault();
  const b = Object.fromEntries(new FormData(f).entries());
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (f.id === 'join-form') { unlockAlerts(); const st = await getStore(); const code = await E.joinParticipant(st, b.code, b.name); startSession({ code, kind: 'participant' }); return; }
    if (f.id === 'staff-form') { unlockAlerts(); const st = await getStore(); const code = await E.joinStaff(st, b.code, b.name, b.pin); rememberSession({ code }); startSession({ code, kind: 'staff' }); return; }
    if (f.id === 'create-form') { unlockAlerts(); const st = await getStore(); const code = await E.createSession(st, { ...b, durationMinutes: createDraft.dur, mode: createDraft.mode }); rememberSession({ code, topic: b.lessonTopic || 'AI-enabled learning', cohort: b.cohort || 'CET Cohort' }); qrOnOpen = true; startSession({ code, kind: 'staff' }); return; }
    if (f.id === 'rename-form') { await sess.rename(b.name); toast('Name updated. Trying again…'); return; }
    if (f.id === 'plan-form') { await cmd('addPlan', { scenarioId: b.scenarioId, offsetSeconds: Math.round(Number(b.min) * 60) }, 'Added to timeline'); return; }
    if (f.id === 'custom-form') { const send = e.submitter?.dataset.send === '1'; const r = await cmd('addCustomScenario', { ...b, sendNow: send }, send ? 'Saved and dealt' : 'Card saved. Find it under that learner.'); if (r) f.reset(); return; }
    if (f.id === 'note-form') {
      const id = f.dataset.id, ri = Number(f.dataset.round) || undefined;
      const payload = { text: b.text || '', roundIndex: ri, flagged: !!f.querySelector('[name=flagged]')?.checked };
      if ('competency' in b) payload.competency = b.competency;
      if ('polarity' in b) payload.polarity = b.polarity;
      if (!id && f.dataset.at !== '') payload.elapsedAt = Number(f.dataset.at);
      if (!id && !payload.text.trim() && !payload.flagged) { toast('Type a note first.', true); return; }
      closeModal();
      if (id) await cmd('editObservation', { id, ...payload }, 'Saved');
      else { const res = await cmd('observe', { ...payload, target: payload.competency === 'Support Trainer' ? 'support' : 'lead' }, 'Note saved'); if (res?.observationId && (!ri || ri === S.round.index)) { lastLogged = { id: res.observationId, at: Date.now() }; render(true); } }
      if (ri && ri !== S.round.index) loadArchived();
      return;
    }
  } catch (err) { toast(err.message || 'Something went wrong. Please try again.', true); }
  finally { if (btn) btn.disabled = false; }
});

// ---------------- boot ----------------
async function boot() {
  render(true);
  if (!identity) { getStore().catch(e => { store = null; bootError = { message: e.message, help: e.help, code: e.code }; render(true); }); return; }
  try { await getStore(); attach(); }
  catch (e) { store = null; bootError = { message: e.message || String(e), help: e.help, code: e.code }; render(true); }
}
boot();
}
