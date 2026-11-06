import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';

function setup(n = 8) {
  let now = 1_000_000;
  const s = L.createSession({ durationMinutes: 10, cohort: 'Test' }, now); s.code = 'ABC234';
  const ps = Array.from({ length: n }, (_, i) => L.joinParticipant(s, 'Person ' + (i + 1), now));
  const instr = L.roleOf(s, s.instructorToken);
  return { s, ps, instr, now };
}

test('roles: 5 distinct colours + normal for 6 students, privacy of other roles', () => {
  const { s, ps, instr, now } = setup(8);
  L.applyCommand(s, instr, { action: 'setTrainers', leadId: ps[0].id, supportId: ps[1].id }, now);
  L.applyCommand(s, instr, { action: 'assignRoles' }, now);
  const roles = Object.values(s.round.roles);
  assert.equal(roles.length, 6);
  assert.deepEqual([...new Set(roles.filter(r => r !== 'normal'))].sort(), ['black', 'blue', 'green', 'red', 'yellow']);
  assert.equal(s.round.planned.length, 3);
  const studentView = L.redact(s, L.roleOf(s, ps[3].token), now);
  assert.equal(studentView.participants, undefined);
  assert.equal(studentView.scenarios, undefined);
  assert.ok(['red', 'green', 'yellow', 'blue', 'black', 'normal'].includes(studentView.round.myRole));
  const leadView = L.redact(s, L.roleOf(s, ps[0].token), now);
  assert.equal(leadView.me.type, 'lead');
  assert.equal(leadView.round.partnerName, 'Person 2');
});

test('small group gets problem profiles before green', () => {
  const { s, ps, instr, now } = setup(4);
  L.applyCommand(s, instr, { action: 'setTrainers', leadId: ps[0].id, supportId: ps[1].id }, now);
  L.applyCommand(s, instr, { action: 'assignRoles' }, now);
  assert.ok(!Object.values(s.round.roles).includes('green'));
});

test('scheduler fires planned scenario, auto-ends after 90s, timer completes', () => {
  const { s, ps, instr } = setup(8);
  let now = 2_000_000;
  L.applyCommand(s, instr, { action: 'setTrainers', leadId: ps[0].id, supportId: ps[1].id }, now);
  L.applyCommand(s, instr, { action: 'assignRoles' }, now);
  L.applyCommand(s, instr, { action: 'start' }, now);
  const first = s.round.planned.slice().sort((a, b) => a.offsetSeconds - b.offsetSeconds)[0];
  now += first.offsetSeconds * 1000 + 100;
  assert.equal(L.tick(s, now), true);
  const inc = s.round.incidents[0];
  assert.equal(inc.status, 'active');
  const target = s.participants.find(p => p.id === inc.participantId);
  const view = L.redact(s, L.roleOf(s, target.token), now);
  assert.equal(view.round.incidents[0].scenario.id, inc.scenarioId);
  L.studentAction(s, L.roleOf(s, target.token), { action: 'acknowledge', instanceId: inc.id }, now);
  assert.ok(inc.acknowledgedAt);
  now += 91000; L.tick(s, now);
  assert.equal(inc.status, 'resolved');
  now += 10 * 60000; L.tick(s, now);
  assert.equal(s.round.status, 'ended');
});

test('evaluator: PIN, quick tags, flags, incident rating, assess, cannot control round', () => {
  const { s, ps, instr, now } = setup(8);
  assert.throws(() => L.joinEvaluator(s, 'Eva', '000000', now), /PIN/);
  const ev = L.joinEvaluator(s, 'Eva', s.evaluatorPin, now);
  const who = L.roleOf(s, ev.token);
  assert.equal(who.kind, 'evaluator');
  assert.throws(() => L.applyCommand(s, who, { action: 'start' }, now), /instructor/i);
  L.applyCommand(s, instr, { action: 'setTrainers', leadId: ps[0].id, supportId: ps[1].id }, now);
  L.applyCommand(s, instr, { action: 'assignRoles' }, now);
  L.applyCommand(s, instr, { action: 'start' }, now);
  const color = Object.values(s.round.roles).find(c => c === 'blue');
  const sc = L.SCENARIOS.find(x => x.color === color);
  L.applyCommand(s, instr, { action: 'trigger', scenarioId: sc.id }, now + 5000);
  const { observationId } = L.applyCommand(s, who, { action: 'observe', tagId: 'CA5' }, now + 8000);
  const o = s.round.observations.find(x => x.id === observationId);
  assert.equal(o.competency, 'Classroom awareness'); assert.equal(o.polarity, '-'); assert.equal(o.incidentIds.length, 1); assert.equal(o.by, 'Eva');
  L.applyCommand(s, who, { action: 'observe', flagged: true }, now + 9000);
  assert.equal(s.round.observations.filter(x => x.flagged).length, 1);
  L.applyCommand(s, who, { action: 'editObservation', id: observationId, text: 'Took ~40s to see Person 5' }, now + 10000);
  const inc = s.round.incidents[0];
  L.applyCommand(s, who, { action: 'rateIncident', instanceId: inc.id, noticed: 'late', response: 'effective', handledBy: 'support' }, now + 11000);
  assert.deepEqual([inc.rating.noticed, inc.rating.response, inc.rating.handledBy], ['late', 'effective', 'support']);
  assert.throws(() => L.applyCommand(s, who, { action: 'rateIncident', instanceId: inc.id, noticed: 'bogus' }, now), /Invalid/);
  L.applyCommand(s, who, { action: 'assess', scores: { 'Classroom awareness': '2' }, leadNotes: 'x', supportNotes: 'y', decision: 'pending' }, now + 12000);
  assert.equal(s.round.scores['Classroom awareness'], '2'); assert.equal(s.round.savedBy, 'Eva');
  const csv = L.exportCsv(s, []);
  assert.match(csv, /Noticed late/); assert.match(csv, /incident-rating/);
});

test('next round archives, rotates trainers, blocks duplicate names and mid-round joins', () => {
  const { s, ps, instr, now } = setup(6);
  assert.throws(() => L.joinParticipant(s, 'person 1', now), /already joined/);
  L.applyCommand(s, instr, { action: 'setTrainers', leadId: ps[0].id, supportId: ps[1].id }, now);
  L.applyCommand(s, instr, { action: 'assignRoles' }, now);
  L.applyCommand(s, instr, { action: 'start' }, now);
  assert.throws(() => L.joinParticipant(s, 'Late Comer', now), /in progress/);
  L.applyCommand(s, instr, { action: 'end' }, now + 1000);
  const out = L.applyCommand(s, instr, { action: 'nextRound' }, now + 2000);
  assert.equal(out.archive.index, 1); assert.equal(out.archive.leadName, 'Person 1');
  assert.equal(s.round.index, 2); assert.equal(s.round.leadId, ps[1].id); assert.equal(s.round.supportId, ps[2].id);
  assert.equal(s.archivedRounds.length, 1);
  const data = L.exportData(s, [out.archive]);
  assert.ok(!JSON.stringify(data).includes(ps[0].token));
  assert.ok(!JSON.stringify(data).includes(s.instructorToken));
});

test('evaluator can send and resolve scenarios; manual mode stops the automatic timeline; flags take quick-log items; note time is kept', () => {
  const { s, ps, instr } = setup(8);
  let now = 3_000_000;
  const ev = L.joinEvaluator(s, 'Eva', s.evaluatorPin, now), who = L.roleOf(s, ev.token);
  L.applyCommand(s, instr, { action: 'setTrainers', leadId: ps[0].id, supportId: ps[1].id }, now);
  L.applyCommand(s, instr, { action: 'assignRoles' }, now);
  assert.throws(() => L.applyCommand(s, who, { action: 'setAutoPrompts', on: false }, now), /instructor/i);
  L.applyCommand(s, instr, { action: 'setAutoPrompts', on: false }, now);
  L.applyCommand(s, instr, { action: 'start' }, now);
  now += 11 * 60000 - 1; // well past every planned time, still in round? 10-min round ends; use 9 min
  now = 3_000_000 + 9 * 60000; L.tick(s, now);
  assert.equal(s.round.incidents.length, 0, 'no automatic prompts in manual mode');
  const sc = L.SCENARIOS.find(x => x.color === 'red');
  L.applyCommand(s, who, { action: 'trigger', scenarioId: sc.id }, now);
  const inc = s.round.incidents[0];
  assert.equal(inc.sentBy, 'Eva');
  L.applyCommand(s, who, { action: 'resolve', instanceId: inc.id }, now + 1000);
  assert.equal(inc.status, 'resolved');
  assert.throws(() => L.applyCommand(s, who, { action: 'pause' }, now), /instructor/i);
  const { observationId } = L.applyCommand(s, who, { action: 'observe', flagged: true }, now + 2000);
  L.applyCommand(s, who, { action: 'editObservation', id: observationId, tagId: 'CM4' }, now + 3000);
  const o = s.round.observations.find(x => x.id === observationId);
  assert.equal(o.flagged, true); assert.equal(o.competency, 'Classroom management'); assert.equal(o.polarity, '-');
  const r2 = L.applyCommand(s, who, { action: 'observe', text: 'started earlier', elapsedAt: 60000 }, now + 4000);
  assert.equal(s.round.observations.find(x => x.id === r2.observationId).elapsed, 60000);
});
