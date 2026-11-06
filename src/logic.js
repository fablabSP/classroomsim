// ClassroomSim core logic. Pure functions over a plain session object.
// Runs unchanged in Cloudflare Workers and in Node (for tests).
import SCENARIOS from './scenarios.js';
import { QUICK_TAGS, RUBRIC, SUPPORT_AREA } from './quicktags.js';

export { SCENARIOS, QUICK_TAGS, RUBRIC };
export const VERSION = '3.4.0';
export const COLORS = ['red', 'green', 'yellow', 'blue', 'black'];
export const PHASES = ['explanation', 'discussion', 'independent', 'group', 'conclusion'];
export const DURATIONS = [5, 10, 15, 20, 30];
export const INCIDENT_SECONDS = 90;
const MAX_EVENTS = 250;
const MAX_PARTICIPANTS = 80;
export const PER_COLOUR = [1, 2, 3];
export const PARTICIPANT_MINUTES = 60;
const MAX_EVALUATORS = 10;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: easy to read aloud

export class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (m, status) => { throw new UserError(m, status); };

// ---------- helpers ----------
export function randomInt(max) { // 0 <= n < max
  const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max;
}
export function newId() {
  const b = new Uint8Array(15); crypto.getRandomValues(b);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function newCode() { let c = ''; for (let i = 0; i < 6; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]; return c; }
// Evaluator code: 10 characters from an alphabet with no look-alikes, shown as XXXX-XXXX-XX.
// About 8 x 10^14 combinations, so it cannot be guessed by trying them all.
export function newEvaluatorCode() { let c = ''; for (let i = 0; i < 10; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]; return formatEvaluatorCode(c); }
export function formatEvaluatorCode(raw) { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 10 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c; }
const newPin = newEvaluatorCode;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
function shuffle(xs) { for (let i = xs.length - 1; i > 0; i--) { const j = randomInt(i + 1); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; }
export function catalog(s) { return [...(s.customScenarios || []).slice().reverse(), ...SCENARIOS]; }
export function elapsed(r, now) { return Math.max(0, (r.accumulatedMs || 0) + (r.status === 'running' ? now - r.startedAt : 0)); }
export function remain(r, now) { return Math.max(0, r.durationMinutes * 60000 - elapsed(r, now)); }
const nameOf = (s, pid) => s.participants.find(p => p.id === pid)?.name || 'student';
function log(s, r, kind, detail, now) {
  r.events.push({ id: newId(), time: now, elapsed: elapsed(r, now), kind, detail });
  if (r.events.length > MAX_EVENTS) r.events = r.events.slice(-MAX_EVENTS);
}

// ---------- session ----------
export function createSession(b, now) {
  const dur = DURATIONS.includes(Number(b.durationMinutes)) ? Number(b.durationMinutes) : 10;
  const s = {
    schema: 2, code: null, createdAt: now,
    instructorToken: newId() + newId(),
    instructorName: str(b.instructorName, 70) || 'Evaluator',
    cohort: str(b.cohort, 80) || 'CET Cohort',
    lessonTopic: str(b.lessonTopic, 130) || 'AI-enabled learning',
    mode: b.mode === 'assessment' ? 'assessment' : 'practice',
    durationMinutes: dur, autoPrompts: b.autoPrompts !== false,
    evaluatorPin: newPin(),
    // Participants can use the session until this time; evaluators are never time-limited.
    participantsUntil: now + PARTICIPANT_MINUTES * 60000,
    evaluators: [], participants: [], customScenarios: [], roleHistory: {},
    archivedRounds: [], // [{index, leadName, supportName, decision, endedAt}]
    round: null
  };
  s.round = makeRound(s, null, null);
  return s;
}

export function makeRound(s, leadId, supportId) {
  return {
    index: (s.round?.index || 0) + 1, status: 'lobby', durationMinutes: s.round?.durationMinutes || s.durationMinutes,
    leadId, supportId, leadName: '', supportName: '',
    roles: {}, planned: [], incidents: [], events: [], observations: [],
    scores: Object.fromEntries(RUBRIC.map(k => [k, 'not-observed'])),
    leadNotes: '', supportNotes: '', decision: 'pending', savedBy: null, savedAt: null,
    startedAt: null, accumulatedMs: 0, endedAt: null, activity: 'explanation', assignedAt: null,
    autoPrompts: s.round ? s.round.autoPrompts !== false : s.autoPrompts !== false,
    perColour: s.round?.perColour || 1
  };
}

export function roleOf(s, token) {
  if (!token) return null;
  if (token === s.instructorToken) return { kind: 'instructor', name: s.instructorName };
  const e = s.evaluators.find(x => x.token === token);
  if (e) return { kind: 'evaluator', evaluator: e, name: e.name };
  const p = s.participants.find(x => x.token === token);
  return p ? { kind: 'participant', participant: p, name: p.name } : null;
}

export function joinParticipant(s, rawName, now, id = null) {
  const name = str(rawName, 64);
  if (name.length < 2) fail('Please enter your name (at least 2 letters).');
  if (s.participants.length >= MAX_PARTICIPANTS) fail('This session is full.', 409);
  if (s.participantsUntil && now > s.participantsUntil) fail('This session has closed for participants.', 410);
  if (s.round.status === 'running' || s.round.status === 'paused') fail('A round is in progress. You will be let in when this round finishes.', 409);
  const existing = s.participants.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) fail('Someone with that name has already joined. Add your surname or an initial.', 409);
  if (id && s.participants.some(x => x.id === id)) fail('Already joined.', 409);
  const p = { id: id || newId(), name, token: id ? null : newId() + newId(), joinedAt: now };
  s.participants.push(p);
  log(s, s.round, 'student-joined', name + ' joined', now);
  return p;
}

export function joinEvaluator(s, rawName, pin, now) {
  const name = str(rawName, 64);
  if (name.length < 2) fail('Please enter your name (at least 2 letters).');
  if (String(pin || '').trim() !== s.evaluatorPin) fail('That evaluator PIN is not correct. Ask the instructor for the 6-digit PIN.', 403);
  if (s.evaluators.length >= MAX_EVALUATORS) fail('Evaluator limit reached.', 409);
  const e = { id: newId(), name, token: newId() + newId(), joinedAt: now };
  s.evaluators.push(e);
  log(s, s.round, 'evaluator-joined', name + ' joined as evaluator', now);
  return e;
}

// Firebase: staff identity is checked by security rules (PIN), so the engine just records them.
export function addEvaluator(s, id, rawName, now) {
  if (s.evaluators.some(e => e.id === id)) return null;
  const name = str(rawName, 64) || 'Evaluator';
  const e = { id, name, token: null, joinedAt: now };
  s.evaluators.push(e);
  log(s, s.round, 'evaluator-joined', name + ' joined as staff', now);
  return e;
}

// The private card view one participant can read. Contains no other person's role.
export function participantView(s, pid) {
  const p = s.participants.find(x => x.id === pid); if (!p) return null;
  const r = s.round, names = trainerNames(s, r);
  const type = pid === r.leadId ? 'lead' : pid === r.supportId ? 'support' : 'student';
  const cat = catalog(s);
  return {
    kind: 'participant', code: s.code, cohort: s.cohort, lessonTopic: s.lessonTopic,
    me: { id: pid, name: p.name, type },
    round: {
      index: r.index,
      isAssigned: Boolean(r.assignedAt), assignedAt: r.assignedAt,
      myRole: type === 'student' ? (r.roles[pid] || 'unassigned') : type,
      partnerName: type !== 'student' && r.assignedAt ? (type === 'lead' ? names.support : names.lead) : '',
      incidents: r.incidents.filter(x => x.participantId === pid && x.status !== 'cancelled').map(x => ({ id: x.id, status: x.status, sentAt: x.sentAt, acknowledgedAt: x.acknowledgedAt, intervenedAt: x.intervenedAt, nudgedAt: x.nudgedAt || null, scenario: cat.find(y => y.id === x.scenarioId) || null }))
    }
  };
}

// ---------- roles & plan ----------
export function assign(s, now) {
  const r = s.round;
  const students = s.participants.filter(p => p.id !== r.leadId && p.id !== r.supportId);
  if (!r.leadId || !r.supportId || students.length < 2) fail('Choose a Lead Trainer and Support Trainer, and have at least two other people join first.');
  const hist = id => s.roleHistory[id] || {};
  const per = PER_COLOUR.includes(r.perColour) ? r.perColour : 1;
  const roles = {};
  // Deal in passes: each pass gives out one of each colour. Problem profiles first, green last,
  // so small groups still get meaningful scenarios.
  for (let pass = 0; pass < per; pass++) {
    for (const c of [...shuffle(['red', 'yellow', 'blue', 'black']), 'green']) {
      const candidates = students.filter(p => !roles[p.id]);
      if (!candidates.length) break;
      // Rotation balance: prefer whoever has played this colour least.
      const min = Math.min(...candidates.map(p => hist(p.id)[c] || 0));
      const pool = candidates.filter(p => (hist(p.id)[c] || 0) === min);
      roles[pool[randomInt(pool.length)].id] = c;
    }
  }
  for (const p of students) if (!roles[p.id]) roles[p.id] = 'normal';
  r.roles = roles; r.assignedAt = now;
  for (const p of students) { s.roleHistory[p.id] ??= {}; s.roleHistory[p.id][roles[p.id]] = (s.roleHistory[p.id][roles[p.id]] || 0) + 1; }
  makePlan(s);
  log(s, r, 'roles-assigned', 'Role cards dealt privately to phones', now);
}
export function makePlan(s) {
  const r = s.round;
  const per = r.perColour || 1;
  const holders = shuffle(Object.keys(r.roles).filter(pid => ['red', 'yellow', 'blue', 'black'].includes(r.roles[pid])));
  const n = Math.min(holders.length, 3 * per, 6);
  const total = r.durationMinutes * 60;
  const jitter = Math.min(12, Math.floor(total * 0.02));
  r.planned = holders.slice(0, n).map((pid, i) => {
    const c = r.roles[pid];
    const list = SCENARIOS.filter(x => x.color === c && x.difficulty !== 'challenging');
    const at = Math.round(total * (0.15 + 0.65 * (i + 0.5) / n));
    return { id: newId(), scenarioId: list[randomInt(list.length)].id, participantId: pid, offsetSeconds: Math.max(15, at + randomInt(jitter * 2 + 1) - jitter), state: 'pending' };
  }).sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}

// The parts of the round every phone may see: the clock and what is happening. Kept in the public session doc.
export function publicRound(s) {
  const r = s.round;
  return { index: r.index, status: r.status, durationMinutes: r.durationMinutes, startedAt: r.startedAt, accumulatedMs: r.accumulatedMs, activity: r.activity };
}

export function activate(s, scenarioId, participantId, source, now, sentBy = null) {
  const r = s.round, sc = catalog(s).find(x => x.id === scenarioId);
  if (!sc) fail('Scenario not found.');
  if (r.status !== 'running') fail('Start the round first, then send scenarios.');
  const holders = Object.keys(r.roles).filter(p => r.roles[p] === sc.color);
  if (!holders.length) fail(`Nobody has the ${sc.color} role this round.`);
  const free = holders.filter(p => !r.incidents.some(x => x.participantId === p && x.status === 'active'));
  const target = participantId || (free.length ? free[randomInt(free.length)] : holders[0]);
  if (r.roles[target] !== sc.color) fail(`That person does not hold the ${sc.color} role card.`);
  if (r.incidents.some(x => x.participantId === target && x.status === 'active')) fail(`${nameOf(s, target)} is already acting out a scenario. Resolve it first.`);
  const inc = { id: newId(), scenarioId, participantId: target, color: sc.color, title: sc.title, status: 'active', source, phase: r.activity, sentAt: now, triggerElapsedMs: elapsed(r, now), acknowledgedAt: null, intervenedAt: null, endedAt: null, endedElapsedMs: null, rating: null, sentBy };
  r.incidents.push(inc);
  log(s, r, 'scenario-triggered', `${sc.title} → ${nameOf(s, target)} (${sentBy ? 'sent by ' + sentBy : source})`, now);
  return inc;
}

function endIncident(r, inc, status, now) {
  inc.status = status; inc.endedAt = now; inc.endedElapsedMs = elapsed(r, now);
}

// Lazy scheduler: called on every request. Returns true if anything changed.
export function tick(s, now) {
  const r = s.round;
  if (!r || r.status !== 'running') return false;
  let changed = false;
  if (remain(r, now) <= 0) {
    r.accumulatedMs = r.durationMinutes * 60000; r.status = 'ended'; r.endedAt = now;
    for (const i of r.incidents) if (i.status === 'active') endIncident(r, i, 'resolved', now);
    log(s, r, 'timer-complete', 'Time is up', now);
    return true;
  }
  const el = elapsed(r, now);
  for (const inc of r.incidents) {
    if (inc.status === 'active' && el - (inc.triggerElapsedMs ?? 0) >= INCIDENT_SECONDS * 1000) {
      endIncident(r, inc, 'resolved', now);
      log(s, r, 'scenario-timeout', `${inc.title} ended automatically after ${INCIDENT_SECONDS}s`, now);
      changed = true;
    }
  }
  for (const p of (r.autoPrompts === false ? [] : r.planned)) {
    if (p.state !== 'pending' || el < p.offsetSeconds * 1000) continue;
    const busy = r.incidents.filter(x => x.status === 'active' && x.color !== 'green').length;
    if (busy >= 2 * (r.perColour || 1)) { p.offsetSeconds += 12; changed = true; continue; }
    try { activate(s, p.scenarioId, p.participantId, 'scheduled', now); p.state = 'sent'; }
    catch (e) { p.state = 'skipped'; log(s, r, 'scenario-skipped', e.message, now); }
    changed = true;
  }
  return changed;
}

// ---------- views ----------
function trainerNames(s, r) {
  return { lead: s.participants.find(p => p.id === r.leadId)?.name || r.leadName || '', support: s.participants.find(p => p.id === r.supportId)?.name || r.supportName || '' };
}

export function redact(s, who, now, presence = {}) {
  const r = s.round, staff = who.kind === 'instructor' || who.kind === 'evaluator';
  const names = trainerNames(s, r);
  const base = {
    code: s.code, cohort: s.cohort, lessonTopic: s.lessonTopic, mode: s.mode, version: VERSION,
    kind: who.kind, serverNow: now,
    me: { id: who.participant?.id || who.evaluator?.id || 'instructor', name: who.name },
    round: { index: r.index, status: r.status, durationMinutes: r.durationMinutes, elapsedMs: elapsed(r, now), remainingMs: remain(r, now), activity: r.activity }
  };
  if (staff) {
    const online = id => !!presence[id] && now - presence[id] < 30000;
    base.participants = s.participants.map(p => ({ id: p.id, name: p.name, joinedAt: p.joinedAt, online: online(p.id) }));
    base.evaluators = s.evaluators.map(e => ({ id: e.id, name: e.name, online: online(e.id) }));
    base.round = { ...base.round, autoPrompts: r.autoPrompts !== false, perColour: r.perColour || 1, ...structuredClone({ leadId: r.leadId, supportId: r.supportId, roles: r.roles, assignedAt: r.assignedAt, planned: r.planned, incidents: r.incidents, events: r.events.slice(-60), observations: r.observations, scores: r.scores, leadNotes: r.leadNotes, supportNotes: r.supportNotes, decision: r.decision, savedBy: r.savedBy, savedAt: r.savedAt }), leadName: names.lead, supportName: names.support };
    base.scenarios = catalog(s);
    base.rubric = RUBRIC;
    base.quickTags = QUICK_TAGS;
    base.archivedRounds = s.archivedRounds;
    base.durationOptions = DURATIONS;
    if (who.kind === 'instructor') { base.evaluatorPin = s.evaluatorPin; base.instructorName = s.instructorName; }
    base.participantsUntil = s.participantsUntil || null;
  } else {
    const pid = who.participant.id;
    const type = pid === r.leadId ? 'lead' : pid === r.supportId ? 'support' : 'student';
    base.me.type = type;
    base.round.isAssigned = Boolean(r.assignedAt);
    base.round.myRole = type === 'student' ? (r.roles[pid] || 'unassigned') : type;
    if (type !== 'student' && r.assignedAt) base.round.partnerName = type === 'lead' ? names.support : names.lead;
    const cat = catalog(s);
    base.round.incidents = r.incidents.filter(x => x.participantId === pid && x.status !== 'cancelled').map(x => ({ id: x.id, status: x.status, sentAt: x.sentAt, acknowledgedAt: x.acknowledgedAt, intervenedAt: x.intervenedAt, nudgedAt: x.nudgedAt || null, scenario: cat.find(y => y.id === x.scenarioId) || null }));
  }
  return base;
}

// ---------- commands ----------
const EVAL_ACTIONS = new Set(['observe', 'editObservation', 'deleteObservation', 'rateIncident', 'assess']);
const SEND_ACTIONS = new Set(['trigger', 'triggerActivity', 'resolve', 'cancel', 'nudge', 'extendParticipants', 'closeParticipants']); // instructor + evaluators
export function isEvalAction(a) { return EVAL_ACTIONS.has(a); }

const RATING_FIELDS = {
  noticed: ['quick', 'late', 'missed'],
  response: ['effective', 'partial', 'ineffective'],
  handledBy: ['lead', 'support', 'both', 'none']
};

// Evaluation commands. Work on the live round or an archived one (r).
export function applyEval(s, r, who, b, now) {
  const by = who.name;
  const a = b.action;
  if (a === 'observe') {
    let competency = str(b.competency, 80), polarity = ['+', '-'].includes(b.polarity) ? b.polarity : '', target = b.target === 'support' ? 'support' : 'lead';
    let text = str(b.text, 1000), tagId = null;
    const tag = b.tagId ? QUICK_TAGS.find(t => t.id === b.tagId) : null;
    if (b.tagId && !tag) fail('Unknown quick-log item.');
    if (tag) { tagId = tag.id; competency = tag.competency; polarity = tag.polarity; target = tag.target; }
    const flagged = Boolean(b.flagged);
    if (!competency) competency = target === 'support' ? SUPPORT_AREA : 'General';
    if (![...RUBRIC, SUPPORT_AREA, 'General'].includes(competency)) fail('Choose a competency area.');
    if (!tag && !text && !flagged) fail('Type a note first.');
    if (r.observations.length >= 400) fail('Observation limit reached for this round.');
    const live = r.incidents.filter(x => x.status === 'active').map(x => x.id);
    let el = r.status === 'lobby' ? null : elapsed(r, now);
    if (el != null && Number.isFinite(Number(b.elapsedAt)) && b.elapsedAt !== null) el = Math.max(0, Math.min(el, Math.floor(Number(b.elapsedAt))));
    const at = el != null && r.status === 'running' ? now - Math.max(0, elapsed(r, now) - el) : now;
    const o = { id: newId(), time: at, elapsed: el, phase: r.activity, competency, polarity, target, tagId, text, flagged, incidentIds: live, by, editedAt: null };
    r.observations.push(o);
    return { observationId: o.id };
  }
  if (a === 'editObservation') {
    const o = r.observations.find(x => x.id === b.id); if (!o) fail('That note no longer exists.', 404);
    if ('tagId' in b) { const t = QUICK_TAGS.find(x => x.id === b.tagId); if (!t) fail('Unknown quick-log item.'); o.tagId = t.id; o.competency = t.competency; o.polarity = t.polarity; o.target = t.target; }
    if ('text' in b) o.text = str(b.text, 1000);
    if ('flagged' in b) o.flagged = Boolean(b.flagged);
    if ('polarity' in b) o.polarity = ['+', '-'].includes(b.polarity) ? b.polarity : '';
    if ('competency' in b) { const c = str(b.competency, 80); if (![...RUBRIC, SUPPORT_AREA, 'General'].includes(c)) fail('Choose a competency area.'); o.competency = c; o.target = c === SUPPORT_AREA ? 'support' : 'lead'; }
    o.editedAt = now; o.editedBy = by;
    return {};
  }
  if (a === 'deleteObservation') {
    const before = r.observations.length; r.observations = r.observations.filter(x => x.id !== b.id);
    if (r.observations.length === before) fail('That note no longer exists.', 404);
    return {};
  }
  if (a === 'rateIncident') {
    const inc = r.incidents.find(x => x.id === b.instanceId); if (!inc) fail('Incident not found.', 404);
    inc.rating ??= { noticed: null, response: null, handledBy: null, note: '' };
    for (const [k, allowed] of Object.entries(RATING_FIELDS)) if (k in b) { if (b[k] !== null && !allowed.includes(b[k])) fail('Invalid rating.'); inc.rating[k] = b[k]; }
    if ('note' in b) inc.rating.note = str(b.note, 600);
    inc.rating.by = by; inc.rating.at = now;
    return {};
  }
  if (a === 'assess') {
    const scores = b.scores || {};
    for (const k of RUBRIC) if (!['not-observed', '1', '2', '3', '4'].includes(String(scores[k] ?? 'not-observed'))) fail('Invalid rubric rating.');
    if (!['pending', 'competent', 'not-yet-competent'].includes(b.decision)) fail('Invalid outcome.');
    r.scores = Object.fromEntries(RUBRIC.map(k => [k, String(scores[k] ?? 'not-observed')]));
    r.leadNotes = str(b.leadNotes, 5000); r.supportNotes = str(b.supportNotes, 5000); r.decision = b.decision;
    r.savedBy = by; r.savedAt = now;
    // Change history: every save is kept, so any later change to a result is visible.
    (r.assessLog ||= []).push({ by, at: now, decision: r.decision, scores: { ...r.scores } });
    if (r.assessLog.length > 50) r.assessLog = r.assessLog.slice(-50);
    if (r === s.round) log(s, r, 'assessment-saved', 'Assessment saved by ' + by, now);
    return {};
  }
  fail('Unknown command.');
}

// All commands against the live session. Returns {archive?: round} when a round is archived.
export function applyCommand(s, who, b, now) {
  const a = b.action, r = s.round;
  if (who.kind === 'participant') fail('Instructor access required.', 403);
  if (EVAL_ACTIONS.has(a)) return applyEval(s, r, who, b, now);
  if (who.kind !== 'instructor' && !who.fullControl && !SEND_ACTIONS.has(a)) fail('Only the instructor can do that.', 403);
  const lobby = () => { if (r.status !== 'lobby') fail('You can only change this before the round starts.'); };
  let out = {};
  switch (a) {
    case 'setTrainers': {
      lobby();
      if (!s.participants.some(p => p.id === b.leadId) || !s.participants.some(p => p.id === b.supportId) || b.leadId === b.supportId) fail('Pick two different people as Lead and Support Trainer.');
      r.leadId = b.leadId; r.supportId = b.supportId; r.roles = {}; r.assignedAt = null; r.planned = [];
      log(s, r, 'trainers-selected', `Lead: ${nameOf(s, b.leadId)}, Support: ${nameOf(s, b.supportId)}`, now); break;
    }
    case 'assignRoles': lobby(); assign(s, now); break;
    case 'planDefault': lobby(); if (!r.assignedAt) fail('Assign student roles first.'); makePlan(s); break;
    case 'addPlan': {
      lobby(); const sc = catalog(s).find(x => x.id === b.scenarioId); if (!sc) fail('Scenario not found.');
      const pid = Object.keys(r.roles).find(x => r.roles[x] === sc.color); if (!pid) fail(`Nobody has the ${sc.color} role this round.`);
      const secs = Number(b.offsetSeconds); if (!Number.isFinite(secs) || secs < 0 || secs >= r.durationMinutes * 60) fail('That time is outside the round.');
      r.planned.push({ id: newId(), scenarioId: sc.id, participantId: pid, offsetSeconds: Math.floor(secs), state: 'pending' }); break;
    }
    case 'removePlan': lobby(); r.planned = r.planned.filter(p => p.id !== b.planId); break;
    case 'setDuration': { lobby(); const v = Number(b.durationMinutes); if (!DURATIONS.includes(v)) fail('Choose a valid duration.'); r.durationMinutes = v; s.durationMinutes = v; if (r.assignedAt) makePlan(s); break; }
    case 'addCustomScenario': {
      const color = str(b.color, 12), title = str(b.title, 100), instruction = str(b.instruction, 800), phase = str(b.phase, 30) || 'independent';
      if (!COLORS.includes(color)) fail('Choose a student profile colour.');
      if (!PHASES.includes(phase)) fail('Choose a lesson phase.');
      if (title.length < 3 || instruction.length < 8) fail('Add a short title and a clear instruction for the student.');
      if (s.customScenarios.length >= 50) fail('Custom scenario limit reached.');
      const sc = { id: 'C' + newId().slice(0, 6).toUpperCase(), color, title, phase, difficulty: 'custom', instruction, response: str(b.response, 650) || 'Respond naturally and respectfully if a trainer comes to you.', recovery: str(b.recovery, 650) || 'Go back to normal participation once the trainer has helped.', objective: str(b.objective, 150) || 'Classroom facilitation', context: 'Instructor-created' };
      s.customScenarios.push(sc); out.scenarioId = sc.id;
      log(s, r, 'custom-scenario-created', sc.title, now);
      if (b.sendNow) activate(s, sc.id, null, 'instructor', now, who.name);
      break;
    }
    case 'start': if (r.status !== 'lobby') fail('This round has already started.'); if (!r.assignedAt) fail('Assign student roles before starting.'); r.status = 'running'; r.startedAt = now; r.accumulatedMs = 0; log(s, r, 'round-started', 'Round started', now); break;
    case 'pause': if (r.status !== 'running') fail('The round is not running.'); r.accumulatedMs = elapsed(r, now); r.status = 'paused'; log(s, r, 'round-paused', 'Timer paused', now); break;
    case 'resume': if (r.status !== 'paused') fail('The round is not paused.'); r.startedAt = now; r.status = 'running'; log(s, r, 'round-resumed', 'Timer resumed', now); break;
    case 'end': if (r.status === 'lobby' || r.status === 'ended') fail('The round is not active.'); if (r.status === 'running') r.accumulatedMs = elapsed(r, now); r.status = 'ended'; r.endedAt = now; r.incidents.forEach(x => { if (x.status === 'active') endIncident(r, x, 'resolved', now); }); log(s, r, 'round-ended', 'Instructor ended the round', now); break;
    case 'trigger': activate(s, str(b.scenarioId), str(b.participantId) || null, who.kind, now, who.name); break;
    case 'triggerActivity': {
      const busyIds = new Set(r.incidents.filter(z => z.status === 'active').map(z => z.participantId));
      const freeColours = new Set(Object.keys(r.roles).filter(p => !busyIds.has(p)).map(p => r.roles[p]));
      const sc = shuffle(catalog(s).filter(x => x.phase === r.activity && x.color !== 'green' && freeColours.has(x.color)))[0];
      if (!sc) fail('No matching scenario for this lesson phase right now. Try another phase or pick one from the library.');
      activate(s, sc.id, null, 'activity', now, who.name); break;
    }
    case 'extendParticipants': {
      const mins = Number(b.minutes); if (![15, 30, 60].includes(mins)) fail('Choose 15, 30 or 60 minutes.');
      s.participantsUntil = Math.max(now, s.participantsUntil || now) + mins * 60000;
      log(s, r, 'participants-extended', `${who.name} gave participants ${mins} more minutes`, now); break;
    }
    case 'closeParticipants': {
      s.participantsUntil = now;
      for (const x of r.incidents) if (x.status === 'active') { x.status = 'cancelled'; x.endedAt = now; x.endedElapsedMs = elapsed(r, now); }
      log(s, r, 'participants-closed', `${who.name} closed the session for participants`, now); break;
    }
    case 'nudge': {
      const inc = r.incidents.find(x => x.id === b.instanceId); if (!inc || inc.status !== 'active') fail('That card is no longer in play.');
      inc.nudgedAt = now; inc.nudges = (inc.nudges || 0) + 1;
      log(s, r, 'card-nudged', `${who.name} nudged ${nameOf(s, inc.participantId)} about ${inc.title}`, now); break;
    }
    case 'resolve': case 'cancel': {
      const inc = r.incidents.find(x => x.id === b.instanceId); if (!inc || inc.status !== 'active') fail('That scenario is no longer active.');
      endIncident(r, inc, a === 'resolve' ? 'resolved' : 'cancelled', now);
      log(s, r, a === 'resolve' ? 'scenario-resolved' : 'scenario-cancelled', inc.title, now); break;
    }
    case 'activity': if (!PHASES.includes(b.phase)) fail('Invalid lesson phase.'); r.activity = b.phase; log(s, r, 'activity-changed', b.phase, now); break;
    case 'nextRound': {
      if (r.status !== 'ended') fail('End the current round first.');
      const names = trainerNames(s, r);
      r.leadName = names.lead; r.supportName = names.support;
      out.archive = structuredClone(r);
      s.archivedRounds.push({ index: r.index, leadName: names.lead, supportName: names.support, decision: r.decision, endedAt: r.endedAt, observations: r.observations.length });
      const ps = s.participants, cur = ps.findIndex(p => p.id === r.leadId);
      const lead = ps.length ? ps[(cur + 1) % ps.length].id : null;
      const support = ps.length > 1 ? ps[(cur + 2) % ps.length].id : null;
      s.round = makeRound(s, lead, support === lead ? null : support);
      log(s, s.round, 'round-created', `Round ${s.round.index} ready`, now); break;
    }
    case 'removeParticipant': {
      lobby(); const pid = b.participantId; if (!s.participants.some(p => p.id === pid)) fail('Participant not found.');
      const nm = nameOf(s, pid);
      s.participants = s.participants.filter(p => p.id !== pid);
      if (pid === r.leadId) r.leadId = null; if (pid === r.supportId) r.supportId = null;
      r.roles = {}; r.assignedAt = null; r.planned = [];
      log(s, r, 'participant-removed', nm + ' removed', now); break;
    }
    case 'setPerColour': { lobby(); const v = Number(b.perColour); if (!PER_COLOUR.includes(v)) fail('Choose 1, 2 or 3.'); r.perColour = v; if (r.assignedAt) assign(s, now); break; }
    case 'setAutoPrompts': lobby(); r.autoPrompts = Boolean(b.on); s.autoPrompts = r.autoPrompts; log(s, r, 'prompts-mode', r.autoPrompts ? 'Automatic timeline on' : 'Manual sending only', now); break;
    case 'removeEvaluator': {
      if (!who.isOwner) fail('Only the evaluator who started this session can remove evaluators.', 403);
      const gone = s.evaluators.find(e => e.id === b.evaluatorId); if (!gone) fail('Evaluator not found.');
      s.evaluators = s.evaluators.filter(e => e.id !== b.evaluatorId);
      s.evaluatorPin = newPin(); // so they cannot rejoin with the old code
      log(s, r, 'evaluator-removed', gone.name + ' removed; evaluator code changed', now); break;
    }
    case 'newPin': if (!who.isOwner) fail('Only the evaluator who started this session can change the code.', 403); s.evaluatorPin = newPin(); log(s, r, 'code-changed', 'Evaluator code changed', now); break;
    default: fail('Unknown command.');
  }
  return out;
}

export function studentAction(s, who, b, now) {
  if (who.kind !== 'participant') fail('Participant access required.', 403);
  const r = s.round, inc = r.incidents.find(x => x.id === b.instanceId && x.participantId === who.participant.id);
  if (!inc || inc.status !== 'active') fail('That instruction has already ended.', 409);
  if (b.action === 'acknowledge') { inc.acknowledgedAt ||= now; log(s, r, 'student-acknowledged', who.name + ' read: ' + inc.title, now); }
  else if (b.action === 'intervened') { inc.intervenedAt ||= now; log(s, r, 'trainer-approached', 'Trainer approached ' + who.name, now); }
  else fail('Unknown action.');
  return {};
}

// ---------- exports ----------
export function exportData(s, archived) {
  const strip = ({ token, ...p }) => p;
  return {
    exportedWith: 'ClassroomSim ' + VERSION,
    session: { code: s.code, cohort: s.cohort, lessonTopic: s.lessonTopic, mode: s.mode, instructorName: s.instructorName, createdAt: s.createdAt },
    participants: s.participants.map(strip), evaluators: s.evaluators.map(strip),
    customScenarios: s.customScenarios,
    rounds: [...archived, ...(s.round.status !== 'lobby' || s.round.observations.length ? [s.round] : [])]
  };
}

const csvCell = v => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
const mmss = ms => ms == null ? '' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}`;
export function exportCsv(s, archived) {
  const rows = [['round', 'type', 'lesson_time', 'datetime', 'area', 'polarity', 'detail', 'by']];
  for (const r of exportData(s, archived).rounds) {
    for (const e of r.events) rows.push([r.index, 'event:' + e.kind, mmss(e.elapsed), new Date(e.time).toISOString(), '', '', e.detail, '']);
    for (const o of r.observations) { const t = o.tagId ? QUICK_TAGS.find(x => x.id === o.tagId)?.short : ''; rows.push([r.index, o.flagged ? 'observation (flagged)' : 'observation', mmss(o.elapsed), new Date(o.time).toISOString(), o.competency, o.polarity, [t, o.text].filter(Boolean).join(' — '), o.by]); }
    for (const i of r.incidents) if (i.rating) rows.push([r.index, 'incident-rating', mmss(i.triggerElapsedMs), new Date(i.sentAt).toISOString(), i.title, '', `noticed=${i.rating.noticed || ''}; response=${i.rating.response || ''}; handled_by=${i.rating.handledBy || ''}; ${i.rating.note || ''}`, i.rating.by]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}
