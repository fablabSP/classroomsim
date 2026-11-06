// ClassroomSim session engine for Firebase's free Spark plan.
//
// There is no server code. Staff browsers (instructor and evaluators) run the rules in
// logic.js inside Firestore transactions, so two staff devices can never overwrite each
// other. Every change also writes each participant's private card view, which only that
// participant (and staff) may read under firestore.rules.
//
//   sessions/{code}                 public: owner, topic (anyone signed in may read)
//   sessions/{code}/secret/pin      evaluator PIN (staff only)
//   sessions/{code}/staff/{uid}     staff members (created by the owner, or with the PIN)
//   sessions/{code}/engine/state    full session as JSON (staff only)
//   sessions/{code}/rounds/{n}      finished rounds (staff only)
//   sessions/{code}/views/{uid}     one participant's cards (that participant + staff)
//   sessions/{code}/people/{uid}    participant join + "I read it" signals (that participant + staff)
import * as L from './logic.js';

export const paths = code => ({
  session: `sessions/${code}`, pin: `sessions/${code}/secret/pin`, state: `sessions/${code}/engine/state`,
  staff: `sessions/${code}/staff`, people: `sessions/${code}/people`, views: `sessions/${code}/views`, rounds: `sessions/${code}/rounds`
});
const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const isDenied = e => e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
const cleanCode = c => String(c || '').trim().toUpperCase();

// ---------- joining ----------
export async function createSession(store, form) {
  const now = Date.now();
  const s = L.createSession(form, now);
  s.instructorToken = null;
  s.ownerUid = store.uid;
  for (let attempt = 0; attempt < 6; attempt++) {
    s.code = L.newCode();
    const p = paths(s.code);
    try {
      await store.batch([
        { op: 'set', path: p.session, data: { ownerUid: store.uid, createdAt: now, updatedAt: now, cohort: s.cohort, lessonTopic: s.lessonTopic, round: plain(L.publicRound(s)) } },
        { op: 'set', path: p.pin, data: { pin: s.evaluatorPin } },
        { op: 'set', path: `${p.staff}/${store.uid}`, data: { name: s.instructorName, joinedAt: now, seenAt: now, owner: true } }
      ]);
    } catch (e) { if (isDenied(e)) continue; throw e; } // code already taken
    await store.setDoc(p.state, { data: JSON.stringify(s), v: 1, updatedAt: now });
    return s.code;
  }
  throw new L.UserError('Could not create a session code. Please try again.');
}

async function sessionExists(store, code) {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new L.UserError('A session code has 6 letters and numbers.');
  const d = await store.getDoc(paths(code).session);
  if (!d) throw new L.UserError('Session code not found. Check the code with your instructor.', 404);
  return d;
}

export async function joinStaff(store, rawCode, name, pin) {
  const code = cleanCode(rawCode);
  await sessionExists(store, code);
  if (String(name || '').trim().length < 2) throw new L.UserError('Please enter your name (at least 2 letters).');
  const me = `${paths(code).staff}/${store.uid}`;
  try {
    await store.setDoc(me, { name: String(name).trim().slice(0, 64), joinedAt: Date.now(), seenAt: Date.now(), pin: String(pin || '').trim() });
  } catch (e) {
    if (!isDenied(e)) throw e;
    try { if (await store.getDoc(me)) return code; } catch {} // already staff on this device
    throw new L.UserError('That evaluator PIN is not correct. Ask the evaluator who started the session for the 6-digit PIN.', 403);
  }
  return code;
}

export async function joinParticipant(store, rawCode, name) {
  const code = cleanCode(rawCode);
  await sessionExists(store, code);
  const nm = String(name || '').trim().slice(0, 64);
  if (nm.length < 2) throw new L.UserError('Please enter your name (at least 2 letters).');
  const me = `${paths(code).people}/${store.uid}`;
  const existing = await store.getDoc(me);
  if (existing) await store.updateDoc(me, { name: nm, seenAt: Date.now() });
  else await store.setDoc(me, { name: nm, joinedAt: Date.now(), seenAt: Date.now(), acks: {}, approached: {} });
  return code;
}

// ---------- staff side: runs the session ----------
export class StaffSession {
  constructor(store, code, { onChange, onError } = {}) {
    this.store = store; this.code = code; this.p = paths(code);
    this.onChange = onChange || (() => {}); this.onError = onError || (() => {});
    this.state = null; this.people = []; this.staffDocs = []; this.unsubs = []; this.timers = [];
    this.queue = Promise.resolve(); this.ticking = false; this.notified = new Map();
  }
  start() {
    const { store, p } = this;
    this.unsubs.push(store.onDoc(p.state, d => {
      if (!d) return this.onError(new L.UserError('This session no longer exists.', 404));
      this.state = JSON.parse(d.data); this.state.code = this.code; this.emit(); this.reconcileSoon();
    }, e => this.onError(e)));
    this.unsubs.push(store.onCollection(p.people, list => { this.people = list; this.emit(); this.reconcileSoon(); }, e => this.onError(e)));
    this.unsubs.push(store.onCollection(p.staff, list => { this.staffDocs = list; this.emit(); this.reconcileSoon(); }, e => this.onError(e)));
    this.timers.push(setInterval(() => this.tickCheck(), 1000));
    const beat = () => { if (typeof document === 'undefined' || !document.hidden) store.updateDoc(`${p.staff}/${store.uid}`, { seenAt: Date.now() }).catch(() => {}); };
    beat();
    this.timers.push(setInterval(beat, 40000));
    return this;
  }
  stop() { this.unsubs.forEach(u => u()); this.timers.forEach(clearInterval); this.unsubs = []; this.timers = []; }
  emit() { if (this.state) this.onChange(this.view()); }
  enqueue(fn) { const run = this.queue.then(fn); this.queue = run.catch(() => {}); return run; }

  who() {
    const s = this.state, uid = this.store.uid;
    const name = s?.ownerUid === uid ? s.instructorName : (s?.evaluators.find(e => e.id === uid)?.name || this.staffDocs.find(d => d.id === uid)?.data.name || 'Staff');
    return { kind: 'instructor', fullControl: true, name };
  }
  presence(now) {
    const m = {};
    for (const d of this.people) if (d.data.seenAt) m[d.id] = d.data.seenAt;
    for (const d of this.staffDocs) if (d.data.seenAt) m[d.id] = d.data.seenAt;
    for (const k in m) if (now - m[k] < 90000) m[k] = now; // heartbeat is every 45-60 s
    return m;
  }
  view() {
    const now = Date.now();
    const v = L.redact(this.state, this.who(), now, this.presence(now));
    v.kind = 'staff';
    v.me = { id: this.store.uid, name: this.who().name, isOwner: this.state.ownerUid === this.store.uid };
    v.waiting = this.people.filter(d => !this.state.participants.some(x => x.id === d.id)).map(d => ({ id: d.id, name: d.data.name }));
    return v;
  }

  // Load state, run due timers, apply fn, write state + every changed participant view.
  mutate(fn) {
    return this.enqueue(() => this.store.runTransaction(async tx => {
      const d = await tx.get(this.p.state);
      if (!d) throw new L.UserError('This session no longer exists.', 404);
      const prev = JSON.parse(d.data), s = JSON.parse(d.data);
      prev.code = s.code = this.code;
      const now = Date.now();
      const ticked = L.tick(s, now);
      const out = (fn ? fn(s, now) : null) || { skip: !ticked };
      if (out.skip && !ticked) return out;
      const ids = new Set([...prev.participants, ...s.participants].map(x => x.id));
      for (const id of ids) {
        const before = JSON.stringify(L.participantView(prev, id)), after = L.participantView(s, id);
        if (before !== JSON.stringify(after)) after ? tx.set(`${this.p.views}/${id}`, plain(after)) : tx.delete(`${this.p.views}/${id}`);
      }
      if (s.evaluatorPin !== prev.evaluatorPin) tx.set(this.p.pin, { pin: s.evaluatorPin });
      const pubRound = L.publicRound(s);
      if (JSON.stringify(pubRound) !== JSON.stringify(L.publicRound(prev)) || out.forcePublic) tx.update(this.p.session, { round: plain(pubRound), updatedAt: now });
      if (out.archive) tx.set(`${this.p.rounds}/${out.archive.index}`, { index: out.archive.index, data: JSON.stringify(out.archive) });
      tx.set(this.p.state, { data: JSON.stringify(s), v: (d.v || 0) + 1, updatedAt: now });
      return out;
    }));
  }

  async command(body) {
    const ri = Number(body.roundIndex);
    if (L.isEvalAction(body.action) && ri && this.state && ri !== this.state.round.index) return this.archivedCommand(ri, body);
    const out = await this.mutate((s, now) => L.applyCommand(s, this.who(), body, now) || {});
    if (body.action === 'removeEvaluator') await this.store.deleteDoc(`${this.p.staff}/${body.evaluatorId}`).catch(() => {});
    if (body.action === 'removeParticipant') await this.store.deleteDoc(`${this.p.people}/${body.participantId}`).catch(() => {});
    const { archive, ...rest } = out || {};
    return rest;
  }
  archivedCommand(ri, body) {
    return this.enqueue(() => this.store.runTransaction(async tx => {
      const rp = `${this.p.rounds}/${ri}`;
      const rd = await tx.get(rp), sd = await tx.get(this.p.state);
      if (!rd) throw new L.UserError('That round was not found.', 404);
      const r = JSON.parse(rd.data), s = JSON.parse(sd.data);
      const out = L.applyEval(s, r, this.who(), body, Date.now());
      tx.set(rp, { index: ri, data: JSON.stringify(r) });
      if (body.action === 'assess') {
        const a = s.archivedRounds.find(x => x.index === ri);
        if (a) { a.decision = r.decision; a.observations = r.observations.length; tx.set(this.p.state, { data: JSON.stringify(s), v: (sd.v || 0) + 1, updatedAt: Date.now() }); }
      }
      return out;
    }));
  }
  async rounds() { return (await this.store.getCollection(this.p.rounds)).map(d => JSON.parse(d.data.data)).sort((a, b) => a.index - b.index); }
  async exportData() { return L.exportData(this.state, await this.rounds()); }
  async exportCsv() { return L.exportCsv(this.state, await this.rounds()); }

  // Timers: any open staff device runs due prompts. Transactions stop double-sending.
  tickCheck() {
    if (!this.state || this.ticking || this.state.round.status !== 'running') return;
    const c = structuredClone(this.state);
    if (!L.tick(c, Date.now())) return;
    this.ticking = true;
    this.mutate(null).catch(e => this.onError(e)).finally(() => { this.ticking = false; });
  }

  // One evaluator device does the background work (letting people in, recording card flips):
  // the session creator if their screen is open, otherwise the first open evaluator device.
  // The others act as backup a few seconds later. Transactions make double work harmless.
  isLeader() {
    const now = Date.now(), uid = this.store.uid;
    const alive = new Set(this.staffDocs.filter(d => now - (d.data.seenAt || 0) < 100000).map(d => d.id));
    alive.add(uid);
    const owner = this.state?.ownerUid;
    if (owner && alive.has(owner)) return owner === uid;
    return [...alive].sort()[0] === uid;
  }
  reconcileSoon() { clearTimeout(this._rt); this._rt = setTimeout(() => this.reconcile().catch(e => this.onError(e)), this.isLeader() ? 250 : 8000); }
  async reconcile() {
    if (this._busy) { this._again = true; return; }
    this._busy = true;
    try { await this._reconcile(); }
    finally { this._busy = false; if (this._again) { this._again = false; this.reconcileSoon(); } }
  }
  async _reconcile() {
    const s = this.state; if (!s) return;
    // new evaluators, all in one write
    const newStaff = this.staffDocs.filter(d => d.id !== s.ownerUid && !s.evaluators.some(e => e.id === d.id));
    if (newStaff.length) await this.mutate((st, now) => { let n = 0; for (const d of newStaff) if (L.addEvaluator(st, d.id, d.data.name, now)) n++; return n ? {} : { skip: true }; });
    // new participants, all in one write (fast when a whole class scans the QR at once)
    const joins = this.people.filter(d => !s.participants.some(x => x.id === d.id) && this.notified.get(d.id) !== d.id + ':' + d.data.name + ':' + s.round.status);
    if (joins.length) {
      let rejected = [];
      await this.mutate((st, now) => {
        rejected = []; let n = 0;
        for (const d of joins) {
          if (st.participants.some(x => x.id === d.id)) continue;
          try { L.joinParticipant(st, d.data.name, now, d.id); n++; }
          catch (e) { if (e instanceof L.UserError) rejected.push({ d, message: e.message }); else throw e; }
        }
        return n ? {} : { skip: true };
      });
      for (const { d, message } of rejected) {
        this.notified.set(d.id, d.id + ':' + d.data.name + ':' + s.round.status);
        await this.store.setDoc(`${this.p.views}/${d.id}`, { kind: 'participant', pending: true, message, me: { id: d.id, name: d.data.name }, code: this.code, lessonTopic: s.lessonTopic }).catch(() => {});
      }
    }
    // "I've read it" and "a trainer came to me", all in one write
    const due = [];
    for (const d of this.people) {
      for (const [field, action] of [['acks', 'acknowledge'], ['approached', 'intervened']]) {
        for (const incId of Object.keys(d.data[field] || {})) {
          const inc = s.round.incidents.find(i => i.id === incId && i.participantId === d.id);
          if (inc && inc.status === 'active' && !(action === 'acknowledge' ? inc.acknowledgedAt : inc.intervenedAt)) due.push({ pid: d.id, incId, action });
        }
      }
    }
    if (due.length) {
      await this.mutate((st, now) => {
        let changed = false;
        for (const x of due) {
          const p = st.participants.find(q => q.id === x.pid); if (!p) continue;
          try { L.studentAction(st, { kind: 'participant', participant: p, name: p.name }, { action: x.action, instanceId: x.incId }, now); changed = true; } catch {}
        }
        return changed ? {} : { skip: true };
      });
    }
  }
}

// ---------- participant side ----------
export class ParticipantSession {
  constructor(store, code, { onView, onError } = {}) {
    this.store = store; this.code = code; this.p = paths(code);
    this.onView = onView || (() => {}); this.onError = onError || (() => {});
    this.unsubs = []; this.timers = []; this.person = undefined; this.view = undefined; this.pub = undefined;
  }
  get me() { return `${this.p.people}/${this.store.uid}`; }
  emit() { if (this.view !== undefined && this.pub !== undefined) this.onView(this.view, this.person, this.pub); }
  start() {
    this.unsubs.push(this.store.onDoc(`${this.p.views}/${this.store.uid}`, v => { this.view = v; this.emit(); }, e => this.onError(e)));
    this.unsubs.push(this.store.onDoc(this.p.session, d => { this.pub = d; this.emit(); }, e => this.onError(e)));
    this.unsubs.push(this.store.onDoc(this.me, d => { const had = this.person; this.person = d; if (!d && had) this.onView(null, null, this.pub); }, e => this.onError(e)));
    // "I'm here" check-in, only between rounds (that is when evaluators look at who is connected)
    const beat = () => {
      const st = this.pub?.round?.status;
      if ((typeof document === 'undefined' || !document.hidden) && st !== 'running' && st !== 'paused') this.store.updateDoc(this.me, { seenAt: Date.now() }).catch(() => {});
    };
    this.timers.push(setInterval(beat, 120000));
    return this;
  }
  stop() { this.unsubs.forEach(u => u()); this.timers.forEach(clearInterval); }
  acknowledge(incId) { return this.store.updateDoc(this.me, { [`acks.${incId}`]: Date.now() }); }
  approached(incId) { return this.store.updateDoc(this.me, { [`approached.${incId}`]: Date.now() }); }
  rename(name) { return this.store.updateDoc(this.me, { name: String(name).trim().slice(0, 64) }); }
  leave() { this.stop(); return this.store.deleteDoc(this.me).catch(() => {}); }
}
