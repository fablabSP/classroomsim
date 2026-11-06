// Load test: several classes at once, a whole class joining in the same moment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryStore } from '../src/store-memory.js';
import * as E from '../src/engine.js';
import { SCENARIOS } from '../src/logic.js';
const BLUE = SCENARIOS.filter(s => s.color === 'blue').map(s => s.id);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(25); } return false; }

async function runClass(hub, n, tag) {
  const owner = new MemoryStore(hub, `u-${tag}-owner`);
  const code = await E.createSession(owner, { instructorName: 'Eval ' + tag, cohort: tag, lessonTopic: 'Topic ' + tag, durationMinutes: 10 });
  const ev1 = new E.StaffSession(owner, code).start();
  const st2 = new MemoryStore(hub, `u-${tag}-ev2`);
  await E.joinStaff(st2, code, 'Second ' + tag, hub.read(`u-${tag}-owner`, E.paths(code).pin).data.pin);
  const ev2 = new E.StaffSession(st2, code).start();
  // everyone scans the QR at the same moment
  const t0 = Date.now();
  const phones = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const st = new MemoryStore(hub, `u-${tag}-p${i}`);
    await E.joinParticipant(st, code, `Person ${tag}${i}`);
    const ph = { st, view: null };
    ph.ps = new E.ParticipantSession(st, code, { onView: (v, _p, pub) => { ph.view = v; ph.pub = pub; } }).start();
    return ph;
  }));
  assert.ok(await until(() => ev1.state?.participants.length === n), `${tag}: all ${n} let in`);
  const joinMs = Date.now() - t0;
  const ids = ev1.state.participants.map(p => p.id);
  await ev2.command({ action: 'setTrainers', leadId: ids[0], supportId: ids[1] });
  await ev2.command({ action: 'setPerColour', perColour: 3 });
  await ev1.command({ action: 'assignRoles' });
  assert.ok(await until(() => phones.every(p => p.view?.round?.isAssigned)), `${tag}: every phone got a card`);
  const roles = Object.values(ev1.state.round.roles);
  for (const c of ['red', 'yellow', 'blue', 'black', 'green']) assert.equal(roles.filter(x => x === c).length, 3, `${tag}: 3 x ${c}`);
  await ev1.command({ action: 'start' });
  assert.ok(await until(() => phones.every(p => p.pub?.round?.status === 'running')), `${tag}: every phone sees the clock running`);
  // both evaluators deal cards and log notes at the same time
  const blues = ids.filter(id => ev1.state.round.roles[id] === 'blue');
  await Promise.all([
    ev1.command({ action: 'trigger', scenarioId: BLUE[0], participantId: blues[0] }),
    ev2.command({ action: 'trigger', scenarioId: BLUE[1], participantId: blues[1] }),
    ...Array.from({ length: 10 }, (_, i) => (i % 2 ? ev1 : ev2).command({ action: 'observe', tagId: 'CA1' }))
  ]);
  const holders = phones.filter(p => p.view?.round?.incidents?.some(i => i.status === 'active'));
  assert.ok(await until(() => phones.filter(p => p.view?.round?.incidents?.some(i => i.status === 'active')).length === 2), `${tag}: two blue phones hold cards`);
  for (const p of phones.filter(p => p.view.round.incidents.some(i => i.status === 'active'))) await p.ps.acknowledge(p.view.round.incidents[0].id);
  assert.ok(await until(() => ev2.state.round.incidents.filter(i => i.acknowledgedAt).length === 2), `${tag}: flips recorded`);
  assert.equal(ev1.state.round.observations.length, 10, `${tag}: no notes lost`);
  await ev1.command({ action: 'end' });
  return { joinMs, stop: () => { ev1.stop(); ev2.stop(); phones.forEach(p => p.ps.stop()); }, holders };
}

test('3 classes x 40 people at once, 2 evaluators each', async () => {
  const hub = new MemoryHub({ rules: true });
  const results = await Promise.all(['A', 'B', 'C'].map(t => runClass(hub, 40, t)));
  console.log(`join time for 40 people: ${results.map(r => r.joinMs + ' ms').join(', ')}`);
  console.log(`database use for 3 classes x 1 round: ${hub.writes} writes, ${hub.reads} reads`);
  results.forEach(r => r.stop());
  assert.ok(results.every(r => r.joinMs < 8000), 'everyone in within 8 s');
});
