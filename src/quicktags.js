// Preloaded quick-log issues for evaluators.
// One tap logs the issue with a timestamp, lesson phase and any live incident,
// so evaluators can capture evidence fast and write it up properly afterwards.
//
// polarity: '+' strength, '-' area to improve
// target:   'lead' (formally assessed) or 'support' (developmental only)
// short:    the label on the button (keep under ~32 characters)
// detail:   the sentence used when drafting written feedback
//
// Edit freely. Keep ids stable once a cohort has used them (old records reference them).

export const RUBRIC = [
  'Lesson facilitation',
  'Classroom awareness',
  'Learner engagement',
  'Classroom management',
  'Differentiated support',
  'Lead–Support coordination'
];

export const SUPPORT_AREA = 'Support Trainer';

const T = (id, competency, polarity, short, detail, target = 'lead') => ({ id, competency, polarity, short, detail, target });

export const QUICK_TAGS = [
  // Lesson facilitation
  T('LF1', RUBRIC[0], '+', 'Clear instructions', 'gave clear, step-by-step instructions and stated the purpose of the task'),
  T('LF2', RUBRIC[0], '+', 'Checked understanding', 'checked for understanding before moving on'),
  T('LF3', RUBRIC[0], '+', 'Smooth transition', 'moved smoothly between lesson activities'),
  T('LF4', RUBRIC[0], '-', 'Instructions unclear', 'gave instructions that were unclear and had to be repeated'),
  T('LF5', RUBRIC[0], '-', 'Rushed / lost time', 'lost track of time or rushed key parts of the lesson'),
  T('LF6', RUBRIC[0], '-', 'Talked at class too long', 'spoke for long stretches with little learner interaction'),

  // Classroom awareness
  T('CA1', RUBRIC[1], '+', 'Scanned the room', 'scanned the room regularly while teaching'),
  T('CA2', RUBRIC[1], '+', 'Spotted issue early', 'noticed a learner issue early, before it grew'),
  T('CA3', RUBRIC[1], '-', 'Back to class too long', 'turned away from the class for long periods (screen or board)'),
  T('CA4', RUBRIC[1], '-', 'Missed a learner signal', 'did not notice a learner who needed attention'),
  T('CA5', RUBRIC[1], '-', 'Noticed late', 'noticed a learner issue only after it had gone on for a while'),

  // Learner engagement
  T('LE1', RUBRIC[2], '+', 'Used names / invited quiet ones', 'used learner names and invited quieter learners to contribute'),
  T('LE2', RUBRIC[2], '+', 'Linked task to purpose', 'linked the task to a real purpose to motivate learners'),
  T('LE3', RUBRIC[2], '+', 'Specific praise', 'gave specific, encouraging praise'),
  T('LE4', RUBRIC[2], '-', 'Same few answering', 'let the same few learners answer most questions'),
  T('LE5', RUBRIC[2], '-', 'Few questions asked', 'asked few questions, so learners were mostly passive'),

  // Classroom management
  T('CM1', RUBRIC[3], '+', 'Calm redirection', 'redirected off-task behaviour calmly and respectfully'),
  T('CM2', RUBRIC[3], '+', 'Set clear expectations', 'set clear expectations for behaviour and turn-taking'),
  T('CM3', RUBRIC[3], '+', 'Handled privately', 'dealt with the behaviour privately without stopping the class'),
  T('CM4', RUBRIC[3], '-', 'Ignored disruption', 'did not address a disruption'),
  T('CM5', RUBRIC[3], '-', 'Public call-out / over-reacted', 'responded more strongly or publicly than the situation needed'),
  T('CM6', RUBRIC[3], '-', 'Lesson derailed', 'let an incident derail the flow of the lesson'),

  // Differentiated support
  T('DS1', RUBRIC[4], '+', 'Gave a small next step', 'broke the task into a small, clear next step for a struggling learner'),
  T('DS2', RUBRIC[4], '+', 'Extension for fast learner', 'offered a suitable extension to a learner who finished early'),
  T('DS3', RUBRIC[4], '+', 'Probed understanding', 'asked the learner to explain in their own words instead of just "okay?"'),
  T('DS4', RUBRIC[4], '-', 'Did it for the learner', 'did the task for the learner instead of guiding them'),
  T('DS5', RUBRIC[4], '-', 'Same help for everyone', 'gave the same help to everyone regardless of need'),

  // Lead–Support coordination
  T('LS1', RUBRIC[5], '+', 'Delegated to Support', 'delegated a learner issue to the Support Trainer appropriately'),
  T('LS2', RUBRIC[5], '+', 'Briefed Support Trainer', 'briefed or checked in with the Support Trainer'),
  T('LS3', RUBRIC[5], '-', 'Did not use Support', 'did not make use of the Support Trainer'),
  T('LS4', RUBRIC[5], '-', 'Both on same learner', 'both trainers attended to the same learner while others waited'),

  // Support Trainer (developmental only, never scored)
  T('ST1', SUPPORT_AREA, '+', 'Helped learner quietly', 'helped a learner quietly without disturbing the class', 'support'),
  T('ST2', SUPPORT_AREA, '+', 'Took initiative', 'took initiative without needing to be asked', 'support'),
  T('ST3', SUPPORT_AREA, '+', 'Kept Lead informed', 'kept the Lead Trainer informed', 'support'),
  T('ST4', SUPPORT_AREA, '-', 'Passive / waited', 'stayed passive and waited to be told what to do', 'support'),
  T('ST5', SUPPORT_AREA, '-', 'Took over from Lead', 'took over the class from the Lead Trainer', 'support'),
  T('ST6', SUPPORT_AREA, '-', 'Distracted the class', 'drew the class’s attention away from the lesson', 'support')
];
