// Tests firestore.rules against the real Firestore emulator.
// Run on your computer (needs Java 11+):  npm run test:rules
import test, { before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env;
const CODE = 'ABC234', P = `sessions/${CODE}`;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'classroomsim-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  const owner = env.authenticatedContext('owner').firestore();
  const b = writeBatch(owner);
  b.set(doc(owner, P), { ownerUid: 'owner', createdAt: 1, updatedAt: 1, cohort: 'C', lessonTopic: 'T' });
  b.set(doc(owner, `${P}/secret/pin`), { pin: '123456' });
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
});
test('staff join needs the PIN', async () => {
  const ev = env.authenticatedContext('ev').firestore();
  await assertFails(setDoc(doc(ev, `${P}/staff/ev`), { name: 'Eva', pin: '000000' }));
  await assertFails(setDoc(doc(ev, `${P}/staff/other`), { name: 'Eva', pin: '123456' }));
  await assertSucceeds(setDoc(doc(ev, `${P}/staff/ev`), { name: 'Eva', pin: '123456', joinedAt: 1 }));
  await assertSucceeds(getDoc(doc(ev, `${P}/engine/state`)));
  await assertSucceeds(setDoc(doc(ev, `${P}/views/p2`), { kind: 'participant', x: 1 }));
});
test('session codes cannot be taken over', async () => {
  const x = env.authenticatedContext('x').firestore();
  await assertFails(setDoc(doc(x, P), { ownerUid: 'x', createdAt: 1, updatedAt: 1, cohort: '', lessonTopic: '' }));
});
