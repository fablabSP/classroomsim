// ClassroomSim PDF report. Built as its own file (public/pdf.js) and loaded only when someone
// downloads a report, so participants' phones never download it.
// buildReport(sessions, opts) -> Blob. `sessions` is a list of L.exportData() results.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable/es'; // the ES build: its default export is the autoTable function
import { RUBRIC, QUICK_TAGS, normalizeGrading, autoGrade, gradingRuleText } from './logic.js';

const DECISION = { pending: 'Not decided', competent: 'Competent', 'not-yet-competent': 'Not yet competent' };
const SCORE = { 'not-observed': 'Not seen', 1: '1 Emerging', 2: '2 Developing', 3: '3 Competent', 4: '4 Proficient' };
const INK = [22, 35, 52], MUTED = [90, 104, 122], GOOD = [23, 128, 74], BAD = [196, 54, 44], SUN = [255, 200, 61];
// The built-in PDF fonts only cover Western European characters: swap the rest for close equivalents.
const clean = v => String(v ?? '').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[✓✔]/g, 'v').replace(/[✕✗]/g, 'x').replace(/⚑/g, '[flag]').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
const mmss = ms => ms == null ? '' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}`;
const when = t => t ? new Date(t).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const day = t => t ? new Date(t).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const avg = r => { const n = Object.values(r.scores || {}).map(Number).filter(v => v >= 1); return n.length ? (n.reduce((a, b) => a + b, 0) / n.length).toFixed(1) : '-'; };
const nameIn = (s, id) => s.participants.find(p => p.id === id)?.name || '-';
const how = r => !r.savedAt ? 'Not assessed' : r.decisionMode === 'auto' ? 'Automatic' : r.overrideReason ? 'Override' : 'By hand';

export function buildReport(sessions, { title = 'ClassroomSim assessment report', by = '', grading } = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 44;
  let y = M;
  const room = need => { if (y + need > H - 56) { doc.addPage(); y = M; } };
  const text = (s, { size = 10, bold = false, color = INK, gap = 4, indent = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(clean(s), W - 2 * M - indent)) { room(size + 3); doc.text(line, M + indent, y + size * 0.8); y += size * 1.3; }
    y += gap;
  };
  const table = (head, body, opts = {}) => {
    autoTable(doc, {
      startY: y, head: [head.map(clean)], body: body.map(r => r.map(c => clean(c))), margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: [205, 213, 223], lineWidth: 0.5, overflow: 'linebreak' },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [245, 247, 250] }, ...opts
    });
    y = doc.lastAutoTable.finalY + 12;
  };
  const h1 = s => { room(60); doc.setFillColor(...SUN); doc.rect(M, y, 5, 22, 'F'); y += 2; text(s, { size: 17, bold: true, indent: 12, gap: 6 }); };
  const h2 = s => { room(50); y += 4; doc.setDrawColor(...INK); doc.setLineWidth(1.2); doc.line(M, y, W - M, y); y += 8; text(s, { size: 13, bold: true, gap: 4 }); };
  const h3 = s => { room(34); text(s, { size: 10.5, bold: true, gap: 2 }); };
  const rounds = [];
  for (const s of sessions) for (const r of s.rounds) rounds.push([s, r]);

  // Cover
  doc.setFillColor(...INK); doc.rect(0, 0, W, 120, 'F'); doc.setFillColor(...SUN); doc.rect(0, 120, W, 5, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text(clean(title), M, 62);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(198, 208, 220);
  doc.text(clean(`${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${rounds.length} round${rounds.length === 1 ? '' : 's'} · generated ${when(Date.now())}${by ? ' by ' + by : ''}`), M, 86);
  y = 150;
  const counts = { competent: 0, 'not-yet-competent': 0, pending: 0 };
  for (const [, r] of rounds) counts[r.decision in counts ? r.decision : 'pending']++;
  text(`Competent: ${counts.competent}    Not yet competent: ${counts['not-yet-competent']}    Not decided: ${counts.pending}`, { size: 11, bold: true, gap: 6 });
  if (grading) text('Score card rule: ' + gradingRuleText(grading), { size: 9, color: MUTED, gap: 10 });
  h3('Summary of every round');
  table(['Date', 'Session', 'Round', 'Lead Trainer', 'Support Trainer', 'Outcome', 'Decided', 'Assessed by', 'Avg'],
    rounds.map(([s, r]) => [day(s.session.createdAt), `${s.session.code}\n${s.session.cohort}`, r.index, r.leadName || nameIn(s, r.leadId), r.supportName || nameIn(s, r.supportId), DECISION[r.decision] || r.decision, how(r), r.savedBy || '-', avg(r)]),
    { didParseCell: d => { if (d.section === 'body' && d.column.index === 5) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = /^Competent/.test(d.cell.raw) ? GOOD : /^Not yet/.test(d.cell.raw) ? BAD : MUTED; } } });

  for (const s of sessions) {
    doc.addPage(); y = M;
    const pn = id => s.participants.find(p => p.id === id)?.name || '-';
    h1(s.session.lessonTopic || 'Session');
    text(`${s.session.cohort} · Session ${s.session.code} · ${s.session.mode === 'assessment' ? 'Assessment' : 'Practice'} mode · started by ${s.session.instructorName} · ${when(s.session.createdAt)}`, { size: 9.5, color: MUTED, gap: 4 });
    const evs = [s.session.instructorName, ...(s.evaluators || []).map(e => e.name)].filter((v, i, a) => v && a.indexOf(v) === i);
    text(`Evaluators: ${evs.join(', ') || '-'}`, { size: 9.5, gap: 2 });
    text(`Participants (${s.participants.length}): ${s.participants.map(p => p.name).join(', ') || '-'}`, { size: 9.5, gap: 8 });
    if (!s.rounds.length) { text('No rounds were run in this session.', { color: MUTED }); continue; }
    for (const r of s.rounds) {
      h2(`Round ${r.index}: ${r.leadName || pn(r.leadId)} (Lead Trainer)`);
      text(`Support Trainer: ${r.supportName || pn(r.supportId)} · ${r.durationMinutes || ''} min round${r.endedAt ? ' · ended ' + when(r.endedAt) : ''}${r.savedBy ? ' · assessed by ' + r.savedBy + ', ' + when(r.savedAt) : ' · not assessed yet'}`, { size: 9, color: MUTED, gap: 6 });
      // Outcome box
      const g = normalizeGrading(r.autoResult?.grading || grading);
      const auto = r.autoResult || { ...autoGrade(r.scores, g), rule: gradingRuleText(g) };
      room(70);
      const ok = r.decision === 'competent', bad = r.decision === 'not-yet-competent';
      doc.setFillColor(...(ok ? [224, 243, 231] : bad ? [253, 230, 227] : [245, 247, 250])); doc.setDrawColor(...(ok ? GOOD : bad ? BAD : MUTED)); doc.setLineWidth(1);
      const boxTop = y; doc.roundedRect(M, y, W - 2 * M, 58, 6, 6, 'FD'); y += 8;
      text(`Outcome: ${DECISION[r.decision] || r.decision}  (${how(r)})`, { size: 12, bold: true, color: ok ? GOOD : bad ? BAD : INK, gap: 0, indent: 10 });
      text(`Score card: ${DECISION[auto.result] || auto.result} - ${auto.summary}`, { size: 9, gap: 0, indent: 10 });
      text(r.overrideReason ? `Reason for override: ${r.overrideReason}` : (auto.rule || ''), { size: 8.5, color: MUTED, gap: 0, indent: 10 });
      y = Math.max(y, boxTop + 58) + 10;
      h3('Scores');
      table(['Area', 'Score', 'Meets the standard'], RUBRIC.map(k => { const v = r.scores?.[k]; return [k + (g.required.includes(k) ? ' (must pass)' : ''), SCORE[v] || v || 'Not seen', Number(v) >= g.minLevel ? 'Yes' : Number(v) >= 1 ? 'No' : '-']; }), { columnStyles: { 0: { cellWidth: 230 } } });
      h3('Lead Trainer feedback'); text(r.leadNotes || 'Not written.', { size: 9.5, gap: 6 });
      h3('Support Trainer feedback (developmental, not scored)'); text(r.supportNotes || 'Not written.', { size: 9.5, gap: 6 });
      const inc = r.incidents.filter(i => i.status !== 'cancelled');
      h3(`Scenario cards (${inc.length})`);
      if (inc.length) table(['Time', 'Card', 'Learner', 'Dealt by', 'Noticed', 'Response', 'Handled by', 'Rated by / note'], inc.map(i => [mmss(i.triggerElapsedMs), `${i.title} (${i.color})`, pn(i.participantId), i.sentBy || 'timeline', i.rating?.noticed || '-', i.rating?.response || '-', i.rating?.handledBy || '-', [i.rating?.by, i.rating?.note].filter(Boolean).join(': ') || '-']));
      else text('None dealt.', { size: 9, color: MUTED });
      h3(`Observation notes (${r.observations.length})`);
      if (r.observations.length) table(['Time', 'By', 'For', 'Area', '+/-', 'Note'], r.observations.slice().sort((a, b) => (a.elapsed ?? 1e12) - (b.elapsed ?? 1e12)).map(o => { const t = o.tagId && QUICK_TAGS.find(x => x.id === o.tagId); return [o.elapsed == null ? 'after' : mmss(o.elapsed), o.by, o.target === 'support' ? 'Support' : 'Lead', o.competency, o.polarity || '', (o.flagged ? '[flagged] ' : '') + [t?.short, o.text].filter(Boolean).join(': ')]; }), { columnStyles: { 5: { cellWidth: 210 } } });
      else text('None.', { size: 9, color: MUTED });
      if ((r.assessLog || []).length) { h3('Change history'); table(['When', 'Who', 'Result', 'How', 'Reason'], r.assessLog.map(x => [when(x.at), x.by, DECISION[x.decision] || x.decision, x.mode === 'auto' ? 'Automatic' : x.mode === 'manual' ? 'By hand' : '-', x.reason || ''])); }
    }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(clean(`ClassroomSim · ${title}`), M, H - 24); doc.text(`Page ${i} of ${n}`, W - M, H - 24, { align: 'right' });
    if (i > 1) doc.text('Rubric areas are provisional. Final competency decisions rest with the authorised assessor.', M, H - 13);
  }
  return doc.output('blob');
}
if (typeof window !== 'undefined') window.CSPDF = { buildReport };
