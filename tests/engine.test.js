import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';
import { MemoryHub, MemoryStore } from '../src/store-memory.js';
import * as E from '../src/engine.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(20); } return false; }

async function setup(n = 8) {
  const hub = new MemoryHub({ rules: true });
  const owner = new MemoryStore(hub, 'u-owner');
  const code = await E.createSession(owner, { instructorName: 'Louis', cohort: 'C1', lessonTopic: 'AI', durationMinutes: 10 });
  const staff = new E.StaffSession(owner, code).start();
  const people = [];
  for (let i = 0; i < n; i++) {
    const st = new MemoryStore(hub, 'u-p' + i);
    await E.joinParticipant(st, code.toLowerCase(), 'Person ' + i);
    let view = null;
    const ps = new E.ParticipantSession(st, code, { onView: v => { view = v; } }).start();
    people.push({ st, ps, get view() { return view; } });
  }
  await until(() => staff.state?.participants.length === n);
  return { hub, owner, code, staff, people };
}

test('rules: participants cannot read the engine, other cards, or staff data', async () => {
  const { hub, code, people, staff } = await setup(3);
  const p0 = people[0].st;
  const P = E.paths(code);
  await assert.rejects(p0.getDoc(P.state), /permission/i);
  await assert.rejects(p0.getDoc(P.pin), /permission/i);
  await assert.rejects(p0.getDoc(`${P.views}/u-p1`), /permission/i);
  await assert.rejects(p0.getDoc(`${P.people}/u-p1`), /permission/i);
  await assert.rejects(p0.setDoc(`${P.views}/u-p0`, { hacked: true }), /permission/i);
  await assert.rejects(p0.updateDoc(`${P.people}/u-p0`, { joinedAt: 1 }), /permission/i);
  await assert.rejects(p0.setDoc(`${P.staff}/u-p0`, { name: 'Sneaky', pin: '000000' }), /permission/i);
  assert.ok(await p0.getDoc(`${P.people}/u-p0`), 'can read own join doc');
  staff.stop();
});

test('staff join needs the PIN; staff get the same controls', async () => {
  const { hub, code, staff, people } = await setup(6);
  const ev = new MemoryStore(hub, 'u-eva');
  await assert.rejects(E.joinStaff(ev, code, 'Eva', '123'), /evaluator code is not correct/);
  await E.joinStaff(ev, code, 'Eva', staff.state.evaluatorPin);
  const evs = new E.StaffSession(ev, code).start();
  await until(() => evs.state?.evaluators.some(e => e.id === 'u-eva'));
  const ids = staff.state.participants.map(p => p.id);
  await evs.command({ action: 'setTrainers', leadId: ids[0], supportId: ids[1] });
  await evs.command({ action: 'assignRoles' });
  await evs.command({ action: 'start' });
  await until(() => staff.state.round.status === 'running');
  assert.equal(staff.state.round.status, 'running', 'evaluator could start the round');
  staff.stop(); evs.stop();
});

test('cards reach only the right phone, flip = acknowledged, timeline fires from a staff device', async () => {
  const { staff, people } = await setup(8);
  const ids = staff.state.participants.map(p => p.id);
  await staff.command({ action: 'setTrainers', leadId: ids[0], supportId: ids[1] });
  await staff.command({ action: 'assignRoles' });
  await until(() => people.every(p => p.view?.round?.isAssigned));
  const roles = people.map(p => p.view.round.myRole);
  assert.deepEqual(roles.slice(0, 2), ['lead', 'support']);
  assert.ok(people.every(p => !JSON.stringify(p.view).includes('"roles"')), 'no one sees the role table');
  await staff.command({ action: 'start' });
  // pull the first timed prompt forward so the ticker sends it
  await staff.mutate(s => { s.round.planned.sort((a, b) => a.offsetSeconds - b.offsetSeconds)[0].offsetSeconds = 0; return {}; });
  assert.ok(await until(() => people.some(p => p.view?.round?.incidents?.some(i => i.status === 'active'))), 'timed card dealt');
  const holder = people.find(p => p.view.round.incidents.some(i => i.status === 'active'));
  const others = people.filter(p => p !== holder);
  assert.ok(others.every(p => !(p.view.round.incidents || []).length), 'others got nothing');
  const inc = holder.view.round.incidents[0];
  await holder.ps.acknowledge(inc.id);
  assert.ok(await until(() => staff.state.round.incidents.find(i => i.id === inc.id)?.acknowledgedAt), 'staff sees the flip');
  assert.ok(await until(() => holder.view.round.incidents[0].acknowledgedAt), 'holder view updated');
  staff.stop();
});

test('two staff devices at once do not lose each other\'s notes', async () => {
  const { hub, code, staff } = await setup(5);
  const ev = new MemoryStore(hub, 'u-eva');
  await E.joinStaff(ev, code, 'Eva', staff.state.evaluatorPin);
  const evs = new E.StaffSession(ev, code).start();
  await until(() => evs.state);
  await Promise.all([
    ...Array.from({ length: 6 }, () => staff.command({ action: 'observe', tagId: 'CA1' })),
    ...Array.from({ length: 6 }, () => evs.command({ action: 'observe', tagId: 'CM1' }))
  ]);
  await until(() => staff.state.round.observations.length === 12);
  assert.equal(staff.state.round.observations.length, 12);
  assert.equal(staff.state.round.observations.filter(o => o.by === 'Eva').length, 6);
  staff.stop(); evs.stop();
});

test('late joiner waits during a round and is let in at the next round; archived round editable', async () => {
  const { hub, code, staff } = await setup(5);
  const ids = staff.state.participants.map(p => p.id);
  await staff.command({ action: 'setTrainers', leadId: ids[0], supportId: ids[1] });
  await staff.command({ action: 'assignRoles' });
  await staff.command({ action: 'start' });
  const late = new MemoryStore(hub, 'u-late'); let lv = null;
  await E.joinParticipant(late, code, 'Late Person');
  new E.ParticipantSession(late, code, { onView: v => { lv = v; } }).start();
  assert.ok(await until(() => lv?.pending), 'told to wait');
  await staff.command({ action: 'end' });
  await staff.command({ action: 'nextRound' });
  assert.ok(await until(() => lv && !lv.pending && lv.me.name === 'Late Person'), 'let in next round');
  await staff.command({ action: 'assess', roundIndex: 1, scores: { 'Classroom awareness': '3' }, leadNotes: 'ok', supportNotes: '', decision: 'competent' });
  const r1 = (await staff.rounds())[0];
  assert.equal(r1.decision, 'competent');
  await until(() => staff.state.archivedRounds[0].decision === 'competent');
  assert.equal(staff.state.archivedRounds[0].decision, 'competent');
  staff.stop();
});

test('security: start passcode, long evaluator code, owner-only controls, removal locks out, participant limits, change history', async () => {
  const hub = new MemoryHub({ rules: true });
  hub.docs.set('config/access', { data: { startCode: 'FABLAB-2026' }, version: 1 }); // set by the admin in the console
  const owner = new MemoryStore(hub, 'u-owner');
  await assert.rejects(E.createSession(owner, { instructorName: 'Louis' }), /start passcode is not correct/);
  await assert.rejects(E.createSession(owner, { instructorName: 'Louis', startPasscode: 'wrong' }), /start passcode is not correct/);
  const code = await E.createSession(owner, { instructorName: 'Louis', startPasscode: 'FABLAB-2026' });
  const staff = new E.StaffSession(owner, code).start();
  await until(() => staff.state);
  const evCode = staff.state.evaluatorPin;
  assert.match(evCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/, 'evaluator code is 10 characters');
  // a participant cannot read course settings or the proof, or flood their own doc
  const p = new MemoryStore(hub, 'u-p'); await E.joinParticipant(p, code, 'Pat');
  await assert.rejects(p.getDoc('config/access'), /permission/i);
  await assert.rejects(p.getDoc(`sessions/${code}/proof/u-owner`), /permission/i);
  await assert.rejects(p.setDoc(`sessions/${code}/proof/u-p`, { key: 'x', extra: 1 }), /permission/i);
  const flood = Object.fromEntries(Array.from({ length: 61 }, (_, i) => ['x' + i, 1]));
  await assert.rejects(p.updateDoc(`sessions/${code}/people/u-p`, { acks: flood }), /permission/i);
  await assert.rejects(p.updateDoc(`sessions/${code}`, { round: { status: 'ended' } }), /permission/i);
  // guessing: lower-case and missing dashes still work for the real code, a near miss does not
  const ev = new MemoryStore(hub, 'u-ev');
  await assert.rejects(E.joinStaff(ev, code, 'Eva', evCode.slice(0, -1) + (evCode.endsWith('A') ? 'B' : 'A')), /not correct/);
  await E.joinStaff(ev, code, 'Eva', evCode.replace(/-/g, '').toLowerCase());
  const evs = new E.StaffSession(ev, code).start();
  await until(() => evs.state?.evaluators.some(e => e.id === 'u-ev'));
  // a guest evaluator cannot change the code or remove the owner
  await assert.rejects(evs.command({ action: 'newPin' }), /Only the evaluator who started/);
  await assert.rejects(ev.updateDoc(`sessions/${code}/secret/pin`, { pin: 'HACK' }), /permission/i);
  await assert.rejects(ev.deleteDoc(`sessions/${code}/staff/u-owner`), /permission/i);
  // owner removes the evaluator: they are locked out and the old code stops working
  await staff.command({ action: 'removeEvaluator', evaluatorId: 'u-ev' });
  await until(() => staff.state.evaluatorPin !== evCode);
  assert.notEqual(staff.state.evaluatorPin, evCode, 'code changed on removal');
  await assert.rejects(ev.getDoc(`sessions/${code}/engine/state`), /permission/i);
  const ev2 = new MemoryStore(hub, 'u-ev2');
  await assert.rejects(E.joinStaff(ev2, code, 'Again', evCode), /not correct/);
  // every assessment save is kept
  await staff.command({ action: 'assess', scores: {}, leadNotes: '', supportNotes: '', decision: 'competent' });
  await staff.command({ action: 'assess', scores: {}, leadNotes: '', supportNotes: '', decision: 'not-yet-competent' });
  await until(() => staff.state.round.assessLog?.length === 2);
  assert.deepEqual(staff.state.round.assessLog.map(x => x.decision), ['competent', 'not-yet-competent']);
  staff.stop(); evs.stop();
});

test('without a start passcode set, anyone can start a session', async () => {
  const hub = new MemoryHub({ rules: true });
  assert.match(await E.createSession(new MemoryStore(hub, 'u-a'), { instructorName: 'A' }), /^[A-Z2-9]{6}$/);
});

test('participants are locked out after the time limit; evaluators keep full access; reopen lets them back', async () => {
  const { hub, code, staff, people } = await setup(5);
  const P = E.paths(code), p0 = people[0];
  assert.ok(staff.state.participantsUntil > Date.now() + 59 * 60000, 'defaults to 1 hour');
  assert.ok((await p0.st.getDoc(P.session)).participantsUntil > Date.now(), 'phones can read the closing time');
  await staff.command({ action: 'closeParticipants' });
  await until(() => (hub.docs.get(P.session)?.data.participantsUntil || 0) <= Date.now());
  await sleep(5);
  await assert.rejects(p0.st.getDoc(`${P.views}/u-p0`), /permission/i, 'cannot read own cards after closing');
  await assert.rejects(p0.st.updateDoc(`${P.people}/u-p0`, { 'acks.x': 1 }), /permission/i, 'cannot send anything after closing');
  const late = new MemoryStore(hub, 'u-late');
  await assert.rejects(E.joinParticipant(late, code, 'Too Late'), /permission/i, 'cannot join after closing');
  assert.ok(await staff.store.getDoc(P.state), 'evaluator still reads everything');
  await staff.command({ action: 'observe', text: 'written after closing', competency: 'General' });
  assert.ok((await staff.rounds()) !== null, 'evaluator still reaches records');
  await staff.command({ action: 'extendParticipants', minutes: 30 });
  await until(() => (hub.docs.get(P.session)?.data.participantsUntil || 0) > Date.now() + 29 * 60000);
  assert.ok(await p0.st.getDoc(`${P.views}/u-p0`), 'reopened: participant can read again');
  staff.stop();
});

test('course admin: needs the admin passcode, sees every session read-only, signed out when the code changes', async () => {
  const { hub, code, staff, people } = await setup(4);
  const P = E.paths(code);
  await staff.command({ action: 'observe', text: 'Good questioning', competency: 'General' });
  const code2 = await E.createSession(new MemoryStore(hub, 'u-other'), { instructorName: 'Ms Koh', cohort: 'C2', lessonTopic: 'Laser cutting' });
  const outsider = new MemoryStore(hub, 'u-snoop');
  // Nobody can list sessions, and admin sign-in fails, until config/admin exists
  await assert.rejects(outsider.query('sessions', { orderBy: 'createdAt', desc: true }), /permission/i);
  await assert.rejects(E.adminSignIn(outsider, 'whatever-passcode'), /not correct|not been set up/i);
  hub.docs.set('config/admin', { data: { code: 'Strong-Admin-Passcode-2026' }, version: 1 });
  await assert.rejects(E.adminSignIn(outsider, 'wrong-passcode'), /not correct/i);
  assert.equal(await E.adminActive(outsider), false);
  await assert.rejects(people[0].st.query('sessions', {}), /permission/i, 'participants cannot list sessions');
  await assert.rejects(staff.store.query('sessions', {}), /permission/i, 'evaluators cannot list other sessions');
  await assert.rejects(outsider.getDoc('config/admin'), /permission/i, 'nobody can read the admin passcode');
  // Correct passcode
  const admin = new MemoryStore(hub, 'u-admin');
  await E.adminSignIn(admin, '  Strong-Admin-Passcode-2026 ');
  assert.equal(await E.adminActive(admin), true);
  const list = await E.adminSessions(admin);
  assert.deepEqual(new Set(list.map(x => x.code)), new Set([code, code2]));
  const rec = await E.adminRecords(admin, code);
  assert.equal(rec.session.code, code);
  assert.ok(rec.rounds.some(r => r.observations.some(o => o.text === 'Good questioning')), 'sees evaluator notes');
  const raw = await E.adminRaw(admin, code);
  assert.ok(raw[P.pin]?.pin, 'sees the evaluator code');
  assert.ok(Object.keys(raw).some(k => k.startsWith(P.people + '/')), 'sees participant docs');
  // Read-only: cannot change anything
  await assert.rejects(admin.setDoc(P.state, { data: '{}' }), /permission/i);
  await assert.rejects(admin.updateDoc(P.session, { participantsUntil: 1 }), /permission/i);
  await assert.rejects(admin.setDoc(`${P.staff}/u-admin`, { name: 'Admin' }), /permission/i);
  await assert.rejects(admin.deleteDoc(`${P.people}/u-p0`), /permission/i);
  await assert.rejects(admin.getDoc(`${P.session}/proof/u-owner`), /permission/i, 'start passcode proof stays hidden');
  // Someone else cannot piggyback on the admin's proof doc
  await assert.rejects(outsider.getDoc('admins/u-admin'), /permission/i);
  await assert.rejects(outsider.setDoc('admins/u-admin', { key: 'x', at: 1 }), /permission/i);
  // Changing the passcode signs every admin out
  hub.docs.set('config/admin', { data: { code: 'New-Admin-Passcode-2027' }, version: 2 });
  assert.equal(await E.adminActive(admin), false);
  await assert.rejects(admin.getDoc(P.state), /permission/i);
  staff.stop();
});
