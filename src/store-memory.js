// In-memory stand-in for Cloud Firestore, used by the tests and the demo page.
// It enforces the same access rules as firestore.rules (see allowed() below), so a
// client that works here is also asking Firestore only for things the rules permit.

const clone = v => (v == null ? v : structuredClone(v));
export class PermissionError extends Error { constructor(msg) { super(msg); this.code = 'permission-denied'; } }

function setPath(obj, dotted, value) {
  const ks = dotted.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = value;
}
const keysOnly = (obj, allowed) => Object.keys(obj || {}).every(k => allowed.includes(k));
const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));

// Mirror of firestore.rules. op: read | create | update | delete
export function allowed(op, path, uid, before, after, get, getAfter) {
  if (!uid) return false;
  const seg = path.split('/');
  if (seg[0] === 'config') return false; // course settings: never readable or writable from the app
  // Course admin: holds a proof doc whose key matches config/admin.code (set in the Firebase console).
  const isAdmin = () => { const a = get(`admins/${uid}`), c = get('config/admin'); return !!(a && c && c.code && a.key === c.code); };
  if (seg[0] === 'admins') {
    if (seg.length !== 2 || seg[1] !== uid || op === 'list') return false;
    if (op === 'read' || op === 'delete') return true;
    const c = get('config/admin');
    return !!(c && c.code) && keysOnly(after, ['key', 'at']) && after.key === c.code;
  }
  if (seg[0] !== 'sessions') return false;
  const code = seg[1];
  const isStaff = () => !!get(`sessions/${code}/staff/${uid}`);
  if (seg.length === 2) {
    if (op === 'list') return isAdmin(); // only the course admin can list every session
    if (op === 'read') return true;
    if (op === 'create') {
      const cfg = get('config/access');
      const passOk = !cfg || !cfg.startCode || getAfter(`sessions/${code}/proof/${uid}`)?.key === cfg.startCode;
      return passOk && after.ownerUid === uid && /^[A-Z2-9]{6}$/.test(code) && keysOnly(after, ['ownerUid', 'createdAt', 'updatedAt', 'cohort', 'lessonTopic', 'round', 'participantsUntil']);
    }
    if (op === 'update') return isStaff() && after.ownerUid === before.ownerUid && changedKeys(before, after).every(k => ['round', 'updatedAt', 'participantsUntil'].includes(k));
    return before.ownerUid === uid;
  }
  if (seg.length !== 4) return false;
  if (op === 'list') op = 'read'; // inside a session, listing follows the read rules
  const sub = seg[2], id = seg[3];
  // The course admin can read (never change) everything in every session, except the start-passcode proof.
  if (op === 'read' && sub !== 'proof' && isAdmin()) return true;
  const ownerAfter = () => getAfter(`sessions/${code}`)?.ownerUid === uid;
  const isOwner = () => get(`sessions/${code}`)?.ownerUid === uid;
  const smallMap = v => v == null || (typeof v === 'object' && Object.keys(v).length <= 60);
  // Participants are locked out after the session's participantsUntil time (server clock); evaluators never are.
  const participantsOpen = () => Date.now() < (get(`sessions/${code}`)?.participantsUntil ?? 8.64e15);
  switch (sub) {
    case 'proof':
      return op === 'create' && id === uid && keysOnly(after, ['key']);
    case 'secret':
      if (op === 'create') return ownerAfter();
      if (op === 'read') return isStaff();
      return op === 'update' && isOwner();
    case 'staff':
      if (op === 'read') return isStaff();
      if (op === 'delete') return id === uid || isOwner();
      if (op === 'create') return id === uid && typeof after.name === 'string' && after.name.length <= 64 && keysOnly(after, ['name', 'joinedAt', 'seenAt', 'pin', 'owner'])
        && (ownerAfter() || (after.pin != null && after.pin === get(`sessions/${code}/secret/pin`)?.pin));
      return id === uid && changedKeys(before, after).every(k => ['seenAt', 'name'].includes(k));
    case 'engine': case 'rounds':
      return isStaff();
    case 'views':
      if (op === 'read') return (id === uid && participantsOpen()) || isStaff();
      return isStaff();
    case 'people':
      if (op === 'read') return id === uid || isStaff();
      if (op === 'create') return id === uid && participantsOpen() && keysOnly(after, ['name', 'joinedAt', 'seenAt', 'acks', 'approached']) && typeof after.name === 'string' && after.name.length >= 2 && after.name.length <= 64 && smallMap(after.acks) && smallMap(after.approached);
      if (op === 'update') return id === uid && participantsOpen() && changedKeys(before, after).every(k => ['name', 'seenAt', 'acks', 'approached'].includes(k)) && typeof after.name === 'string' && after.name.length >= 2 && after.name.length <= 64 && smallMap(after.acks) && smallMap(after.approached);
      return id === uid || isStaff();
    default: return false;
  }
}

// One shared database. Everything is synchronous here; listeners fire on a later tick like Firestore.
export class MemoryHub {
  constructor({ rules = true } = {}) { this.docs = new Map(); this.subs = new Set(); this.rules = rules; this.writes = 0; this.reads = 0; }
  _get = p => this.docs.get(p)?.data ?? null;
  _can(op, path, uid, before, after, getAfter) { return !this.rules || allowed(op, path, uid, before, after, this._get, getAfter || this._get); }
  read(uid, path) {
    const d = this.docs.get(path);
    if (!this._can('read', path, uid, d?.data ?? null, null)) throw new PermissionError('Missing or insufficient permissions: read ' + path);
    this.reads++;
    return { data: clone(d?.data ?? null), version: d?.version || 0 };
  }
  list(uid, colPath) {
    const out = [];
    for (const [p, d] of this.docs) if (p.startsWith(colPath + '/') && !p.slice(colPath.length + 1).includes('/')) {
      if (!this._can('list', p, uid, d.data, null)) throw new PermissionError('Missing or insufficient permissions: list ' + colPath);
      out.push({ id: p.slice(colPath.length + 1), data: clone(d.data) });
    }
    if (!out.length && colPath === 'sessions' && this.rules && !allowed('list', 'sessions/_', uid, null, null, this._get, this._get)) throw new PermissionError('Missing or insufficient permissions: list ' + colPath);
    this.reads += out.length || 1;
    return out;
  }
  commit(uid, writes, reads = {}) {
    for (const [p, ver] of Object.entries(reads)) if ((this.docs.get(p)?.version || 0) !== ver) return { conflict: true };
    const staged = new Map();
    const cur = p => (staged.has(p) ? staged.get(p) : this.docs.get(p)?.data ?? null);
    for (const w of writes) {
      const before = cur(w.path);
      let after;
      if (w.op === 'set') after = w.merge && before ? { ...before, ...clone(w.data) } : clone(w.data);
      else if (w.op === 'update') { if (!before) throw Object.assign(new Error('No document to update: ' + w.path), { code: 'not-found' }); after = clone(before); for (const [k, v] of Object.entries(w.data)) setPath(after, k, clone(v)); }
      else after = null;
      staged.set(w.path, after);
    }
    const getAfter = p => (staged.has(p) ? staged.get(p) : this._get(p));
    for (const [p, after] of staged) {
      const before = this._get(p);
      const op = after === null ? 'delete' : before === null ? 'create' : 'update';
      if (!this._can(op, p, uid, before, after, getAfter)) throw new PermissionError(`Missing or insufficient permissions: ${op} ${p}`);
    }
    for (const [p, after] of staged) {
      if (after === null) this.docs.delete(p);
      else this.docs.set(p, { data: after, version: (this.docs.get(p)?.version || 0) + 1 });
      this.writes++;
    }
    const changed = [...staged.keys()];
    setTimeout(() => { for (const s of this.subs) if (changed.some(s.match)) s.fire(); }, 0);
    return { ok: true };
  }
  subscribe(uid, kind, path, cb, err) {
    // Billing like Firestore: a listener is charged once per changed document (all documents on first load).
    const seen = new Map();
    const charge = () => {
      const now = new Map();
      for (const [p, d] of this.docs) if (kind === 'doc' ? p === path : p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')) now.set(p, d.version);
      let n = 0; for (const [p, v] of now) if (seen.get(p) !== v) n++;
      for (const p of seen.keys()) if (!now.has(p)) n++;
      seen.clear(); now.forEach((v, p) => seen.set(p, v));
      return Math.max(n, kind === 'doc' && !seen.size ? 1 : 0);
    };
    const sub = {
      match: p => (kind === 'doc' ? p === path : p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')),
      fire: () => { try { const before = this.reads; const data = kind === 'doc' ? this.read(uid, path).data : this.list(uid, path); this.reads = before + charge(); cb(data); } catch (e) { err?.(e); } }
    };
    this.subs.add(sub);
    setTimeout(sub.fire, 0);
    return () => this.subs.delete(sub);
  }
}

// Same interface as FirebaseStore. `hub` may be a MemoryHub or an async bridge to one.
export class MemoryStore {
  constructor(hub, uid) { this.hub = hub; this.uid = uid; }
  async init() { return this; }
  async getDoc(path) { return (await this.hub.read(this.uid, path)).data; }
  async getCollection(path) { return this.hub.list(this.uid, path); }
  // Simple ordered query: { orderBy, desc, limit, after } (after = the orderBy value of the last row seen)
  async query(path, { orderBy, desc = false, limit = 50, after } = {}) {
    let rows = await this.hub.list(this.uid, path);
    if (orderBy) rows.sort((a, b) => ((a.data[orderBy] ?? 0) - (b.data[orderBy] ?? 0)) * (desc ? -1 : 1));
    if (orderBy && after != null) rows = rows.filter(r => desc ? r.data[orderBy] < after : r.data[orderBy] > after);
    return rows.slice(0, limit);
  }
  async _commit(writes) { const r = await this.hub.commit(this.uid, writes); if (r.conflict) throw new Error('conflict'); }
  setDoc(path, data, opts = {}) { return this._commit([{ op: 'set', path, data, merge: !!opts.merge }]); }
  updateDoc(path, data) { return this._commit([{ op: 'update', path, data }]); }
  deleteDoc(path) { return this._commit([{ op: 'delete', path }]); }
  batch(ops) { return this._commit(ops); }
  onDoc(path, cb, err) { return this.hub.subscribe(this.uid, 'doc', path, cb, err); }
  onCollection(path, cb, err) { return this.hub.subscribe(this.uid, 'col', path, cb, err); }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const reads = {}, writes = [];
      const tx = {
        get: async p => { const r = await this.hub.read(this.uid, p); reads[p] = r.version; return r.data; },
        set: (p, d) => writes.push({ op: 'set', path: p, data: d }),
        update: (p, d) => writes.push({ op: 'update', path: p, data: d }),
        delete: p => writes.push({ op: 'delete', path: p })
      };
      const out = await fn(tx);
      if (!writes.length) return out;
      const res = await this.hub.commit(this.uid, writes, reads);
      if (!res.conflict) return out;
      await new Promise(r => setTimeout(r, 10 + Math.random() * 30 * (attempt + 1)));
    }
    throw new Error('The database is busy. Please try again.');
  }
}

// ---- bridge so iframes (demo) can share one hub held by the parent page ----
export function serveHub(hub, win = window) {
  const subs = new Map();
  win.addEventListener('message', e => {
    const m = e.data; if (!m || m.t !== 'hub') return;
    const reply = (body) => e.source.postMessage({ t: 'hub-res', id: m.id, ...body }, '*');
    try {
      if (m.op === 'read') reply({ ok: hub.read(m.uid, m.path) });
      else if (m.op === 'list') reply({ ok: hub.list(m.uid, m.path) });
      else if (m.op === 'commit') reply({ ok: hub.commit(m.uid, m.writes, m.reads) });
      else if (m.op === 'sub') subs.set(m.sid, hub.subscribe(m.uid, m.kind, m.path, data => e.source.postMessage({ t: 'hub-snap', sid: m.sid, data }, '*'), err => e.source.postMessage({ t: 'hub-snap', sid: m.sid, error: err.message }, '*')));
      else if (m.op === 'unsub') { subs.get(m.sid)?.(); subs.delete(m.sid); }
    } catch (err) { reply({ error: err.message, code: err.code }); }
  });
}
export class BridgeHub {
  constructor(target = window.parent) {
    this.target = target; this.seq = 0; this.wait = new Map(); this.snaps = new Map();
    window.addEventListener('message', e => {
      const m = e.data; if (!m) return;
      if (m.t === 'hub-res' && this.wait.has(m.id)) { const [res, rej] = this.wait.get(m.id); this.wait.delete(m.id); m.error ? rej(Object.assign(new Error(m.error), { code: m.code })) : res(m.ok); }
      if (m.t === 'hub-snap' && this.snaps.has(m.sid)) { const [cb, err] = this.snaps.get(m.sid); m.error ? err?.(new Error(m.error)) : cb(m.data); }
    });
  }
  _call(body) { return new Promise((res, rej) => { const id = ++this.seq; this.wait.set(id, [res, rej]); this.target.postMessage({ t: 'hub', id, ...body }, '*'); }); }
  read(uid, path) { return this._call({ op: 'read', uid, path }); }
  list(uid, path) { return this._call({ op: 'list', uid, path }); }
  commit(uid, writes, reads) { return this._call({ op: 'commit', uid, writes, reads }); }
  subscribe(uid, kind, path, cb, err) {
    const sid = 's' + (++this.seq); this.snaps.set(sid, [cb, err]);
    this.target.postMessage({ t: 'hub', op: 'sub', sid, uid, kind, path }, '*');
    return () => { this.snaps.delete(sid); this.target.postMessage({ t: 'hub', op: 'unsub', sid }, '*'); };
  }
}
