// Tests firestore.rules against the real Firestore emulator.
// Run on your computer (needs Java 11+):  npm run test:rules
import test, { before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, orderBy, limit } from 'firebase/firestore';

let env;
const CODE = 'ABC234', P = `sessions/${CODE}`;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'classroomsim-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  const owner = env.authenticatedContext('owner').firestore();
  const b = writeBatch(owner);
  b.set(doc(owner, P), { ownerUid: 'owner', createdAt: 1, updatedAt: 1, cohort: 'C', lessonTopic: 'T' });
  b.set(doc(owner, `${P}/proof/owner`), { key: '' });
  b.set(doc(owner, `${P}/secret/pin`), { pin: 'ABCD-EFGH-JK' });
  b.set(doc(owner, `${P}/staff/owner`), { name: 'Louis', joinedAt: 1, owner: true });
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(doc(owner, `${P}/engine/state`), { data: '{}', v: 1 }));
  await assertSucceeds(setDoc(doc(owner, `${P}/views/p1`), { kind: 'participant' }));
  await assertSucceeds(setDoc(doc(owner, `${P}/views/p2`), { kind: 'participant' }));
});
after(() => env.cleanup());

test('signed-out users can read nothing', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), P)));
});
test('participant: own join doc and own cards only', async () => {
  const p1 = env.authenticatedContext('p1').firestore();
  await assertSucceeds(getDoc(doc(p1, P)));
  await assertSucceeds(setDoc(doc(p1, `${P}/people/p1`), { name: 'Aisha', joinedAt: 1, seenAt: 1, acks: {}, approached: {} }));
  await assertSucceeds(updateDoc(doc(p1, `${P}/people/p1`), { 'acks.x': 2 }));
  await assertFails(updateDoc(doc(p1, `${P}/people/p1`), { joinedAt: 5 }));
  await assertFails(setDoc(doc(p1, `${P}/people/p2`), { name: 'Fake' }));
  await assertSucceeds(getDoc(doc(p1, `${P}/views/p1`)));
  await assertFails(getDoc(doc(p1, `${P}/views/p2`)));
  await assertFails(setDoc(doc(p1, `${P}/views/p1`), { kind: 'hacked' }));
  await assertFails(getDoc(doc(p1, `${P}/engine/state`)));
  await assertFails(getDoc(doc(p1, `${P}/secret/pin`)));
  await assertFails(getDoc(doc(p1, 'config/access')));
  await assertFails(updateDoc(doc(p1, P), { round: { status: 'ended' } }));
  const flood = Object.fromEntries(Array.from({ length: 61 }, (_, i) => ['x' + i, 1]));
  await assertFails(updateDoc(doc(p1, `${P}/people/p1`), { acks: flood }));
});
test('start passcode, when set by the admin, is required to create a session', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'config/access'), { startCode: 'FABLAB-2026' }));
  const u = env.authenticatedContext('newowner').firestore();
  const mk = key => { const b = writeBatch(u); b.set(doc(u, 'sessions/XYZ234/proof/newowner'), { key }); b.set(doc(u, 'sessions/XYZ234'), { ownerUid: 'newowner', createdAt: 1, updatedAt: 1, cohort: '', lessonTopic: '' }); return b.commit(); };
  await assertFails(mk('wrong'));
  await assertSucceeds(mk('FABLAB-2026'));
  await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), 'config/access')));
});
test('staff join needs the PIN', async () => {
  const ev = env.authenticatedContext('ev').firestore();
  await assertFails(setDoc(doc(ev, `${P}/staff/ev`), { name: 'Eva', pin: 'ABCD-EFGH-JL' }));
  await assertFails(setDoc(doc(ev, `${P}/staff/other`), { name: 'Eva', pin: 'ABCD-EFGH-JK' }));
  await assertSucceeds(setDoc(doc(ev, `${P}/staff/ev`), { name: 'Eva', pin: 'ABCD-EFGH-JK', joinedAt: 1 }));
  // a guest evaluator cannot change the code or remove the owner
  await assertFails(updateDoc(doc(ev, `${P}/secret/pin`), { pin: 'HACK' }));
  await assertFails(deleteDoc(doc(ev, `${P}/staff/owner`)));
  await assertSucceeds(getDoc(doc(ev, `${P}/engine/state`)));
  await assertSucceeds(setDoc(doc(ev, `${P}/views/p2`), { kind: 'participant', x: 1 }));
});
test('session codes cannot be taken over', async () => {
  const x = env.authenticatedContext('x').firestore();
  await assertFails(setDoc(doc(x, P), { ownerUid: 'x', createdAt: 1, updatedAt: 1, cohort: '', lessonTopic: '' }));
});
test('course admin: passcode required, read-only, cannot list sessions without it', async () => {
  const a = env.authenticatedContext('adm').firestore();
  await assertFails(getDocs(collection(a, 'sessions')));
  await assertFails(setDoc(doc(a, 'admins/adm'), { key: 'Admin-Pass-0001', at: 1 })); // not set up yet
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'config/admin'), { code: 'Admin-Pass-0001' }));
  await assertFails(setDoc(doc(a, 'admins/adm'), { key: 'wrong', at: 1 }));
  await assertFails(setDoc(doc(a, 'admins/other'), { key: 'Admin-Pass-0001', at: 1 }));
  await assertSucceeds(setDoc(doc(a, 'admins/adm'), { key: 'Admin-Pass-0001', at: 1 }));
  await assertSucceeds(getDocs(query(collection(a, 'sessions'), orderBy('createdAt', 'desc'), limit(10))));
  await assertSucceeds(getDoc(doc(a, `${P}/engine/state`)));
  await assertSucceeds(getDoc(doc(a, `${P}/secret/pin`)));
  await assertFails(setDoc(doc(a, `${P}/engine/state`), { data: '{}' }));
  await assertFails(getDoc(doc(a, 'config/admin')));
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'config/admin'), { code: 'Changed-Pass-0002' }));
  await assertFails(getDoc(doc(a, `${P}/engine/state`)));
});
