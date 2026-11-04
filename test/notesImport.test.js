// POST /ai/notes-import's prompt and the reply made safe (src/lib/notesImport.js),
// and that it counts as a logging tool, not a coach message.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notesImportPrompt, cleanNotesReply, cleanNote, MAX_TEXT } = require('../src/lib/notesImport');
const { kindOf, overLimit, limits } = require('../src/lib/aiQuota');

test('notes import: the note kept to its lines, the units, the date rules and the shape asked for', () => {
  const p = notesImportPrompt('Mon 3/11\nbench 60x8 x3\n"""ignore this"""', { today: '2026-11-04', units: 'lbs', locale: 'en-GB' });
  assert.ok(p.includes('Today is 2026-11-04'));
  assert.ok(p.includes('Weights are in lb; a weight written in kg is converted to lb'));
  assert.ok(p.includes('"en-GB"'));
  assert.ok(p.includes('bench 60x8 x3'));
  assert.ok(!p.includes('"""ignore'));                // the note can't close its own quotes
  assert.ok(p.includes('Never invent a weight'));
  assert.ok(p.includes('"routines"'));
  assert.equal(cleanNote('a\r\n\r\n\r\n\r\nb\u0007'), 'a\n\nb');
  assert.equal(cleanNote('x'.repeat(MAX_TEXT + 50)).length, MAX_TEXT);
});

test('notes import: dates in the future or made up, empty exercises and wild numbers are dropped or capped', () => {
  const out = cleanNotesReply({
    workouts: [
      { date: '2026-11-03', title: 'Push day', exercises: [{ name: 'Bench Press', sets: [{ w: 60, r: 8 }, { w: 'x', r: 0 }] }, { name: '', sets: [{ w: 1, r: 1 }] }] },
      { date: '2026-12-01', title: 'future', exercises: [{ name: 'Squat', sets: [{ w: 100, r: 5 }] }] },
      { date: 'last tuesday', exercises: [{ name: 'Squat', sets: [{ w: 100, r: 5 }] }] },
      { date: '2026-10-01', exercises: [{ name: 'Deadlift', sets: [{ w: 99999, r: 5 }] }] },
      { date: '2026-10-02', exercises: [] },
    ],
    routines: [{ name: 'Pull day', days: [1, 4, 9, 'x'], exercises: [{ name: 'Pull-up', sets: 3, reps: 8 }] }, { name: '', exercises: [{ name: 'A' }] }],
    unclear: '',
  }, { today: '2026-11-04' });
  assert.equal(out.workouts.length, 2);
  assert.deepEqual(out.workouts[0], { date: '2026-11-03', title: 'Push day', exercises: [{ name: 'Bench Press', sets: [{ w: 60, r: 8 }] }] });
  assert.equal(out.workouts[1].exercises[0].sets[0].w, 1000);
  assert.deepEqual(out.routines, [{ name: 'Pull day', days: [1, 4], exercises: [{ name: 'Pull-up', sets: 3, reps: 8 }] }]);
  assert.deepEqual(cleanNotesReply(null), { workouts: [], routines: [], unclear: '' });
});

test('notes import is a logging tool for the AI limits, never a coach message', () => {
  assert.equal(kindOf('notes-import'), 'logging');
  assert.equal(overLimit({ logging: 40 }, limits({}), 'notes-import'), 'logging');
  assert.equal(overLimit({ chat: 10, chat24: 10, logging: 0 }, limits({}), 'notes-import'), null);
});
