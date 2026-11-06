// Cloud Firestore + anonymous sign-in. Works on the free Spark plan (no Cloud Functions).
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, runTransaction, writeBatch } from 'firebase/firestore';

export class FirebaseStore {
  constructor(config) {
    this.app = initializeApp(config);
    this.auth = getAuth(this.app);
    this.db = initializeFirestore(this.app, { ignoreUndefinedProperties: true });
    this.uid = null;
  }
  async init() {
    await this.auth.authStateReady();
    if (!this.auth.currentUser) await signInAnonymously(this.auth);
    this.uid = this.auth.currentUser.uid;
    return this;
  }
  ref(path) { return doc(this.db, path); }
  async getDoc(path) { const s = await getDoc(this.ref(path)); return s.exists() ? s.data() : null; }
  async getCollection(path) { const qs = await getDocs(collection(this.db, path)); return qs.docs.map(d => ({ id: d.id, data: d.data() })); }
  setDoc(path, data, opts = {}) { return setDoc(this.ref(path), data, { merge: !!opts.merge }); }
  updateDoc(path, data) { return updateDoc(this.ref(path), data); }
  deleteDoc(path) { return deleteDoc(this.ref(path)); }
  async batch(ops) {
    const b = writeBatch(this.db);
    for (const o of ops) {
      if (o.op === 'set') b.set(this.ref(o.path), o.data, { merge: !!o.merge });
      else if (o.op === 'update') b.update(this.ref(o.path), o.data);
      else b.delete(this.ref(o.path));
    }
    await b.commit();
  }
  onDoc(path, cb, err) { return onSnapshot(this.ref(path), s => cb(s.exists() ? s.data() : null), err); }
  onCollection(path, cb, err) { return onSnapshot(collection(this.db, path), qs => cb(qs.docs.map(d => ({ id: d.id, data: d.data() }))), err); }
  runTransaction(fn) {
    return runTransaction(this.db, t => fn({
      get: async p => { const s = await t.get(this.ref(p)); return s.exists() ? s.data() : null; },
      set: (p, d) => t.set(this.ref(p), d),
      update: (p, d) => t.update(this.ref(p), d),
      delete: p => t.delete(this.ref(p))
    }));
  }
}
