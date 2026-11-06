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
  await assert.rejects(E.joinStaff(ev, code, 'Eva', '123'), /PIN/);
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
