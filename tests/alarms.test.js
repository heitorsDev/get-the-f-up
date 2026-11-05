process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load(name, deps) {
  const file = path.join(__dirname, '..', name);
  const src = fs.readFileSync(file, 'utf8').replace(/^[ \t]*\.(pragma|import)\b.*$/gm, '');
  const mod = { exports: {} };
  const names = Object.keys(deps || {});
  const fn = new Function('module', 'exports', ...names, src + '\n//# sourceURL=' + file);
  fn(mod, mod.exports, ...names.map((n) => deps[n]));
  return mod.exports;
}

const Time = load('Time.js');
const Alarms = load('Alarms.js', { Time });

const M = 60 * 1000;
const H = 60 * M;

// local wall-clock ms. 2026-11-04 is a Wednesday.
function at(y, mo, d, h, mi) {
  return new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();
}

const ids = () => 'a1';

function make(fields, now) {
  return Alarms.create(fields, now, ids);
}

test('create normalizes the fields', () => {
  const a = make({ title: '  standup  ', time: '9:05', days: [5, 1, 1, 9, 'x'], reps: 30 }, at(2026, 11, 4, 8));
  assert.deepEqual(a, {
    id: 'a1', title: 'standup', time: '09:05', days: [1, 5], enabled: true,
    preset: '', reps: 10, anchorAt: at(2026, 11, 4, 8), handledAt: 0
  });
  assert.equal(make({ time: 'nope' }, 0), null);
});

test('validate reports bad input', () => {
  assert.equal(Alarms.validate({ time: '07:30' }), '');
  assert.match(Alarms.validate({ time: '25:00' }), /invalid time/);
  assert.match(Alarms.validate({ time: '07:30', reps: 0 }), /from 1 to/);
  assert.match(Alarms.validate({ time: '07:30', days: 'mon' }), /weekdays/);
});

test('parse accepts the wrapped and bare forms, drops broken entries', () => {
  const good = { id: 'x', time: '07:00', days: [] };
  assert.equal(Alarms.parse(JSON.stringify({ version: 1, alarms: [good, { id: 'y' }] })).alarms.length, 1);
  assert.equal(Alarms.parse(JSON.stringify([good])).alarms.length, 1);
  assert.deepEqual(Alarms.parse(''), { alarms: [], error: '' });
  assert.match(Alarms.parse('{').error, /not valid JSON/);
  assert.match(Alarms.parse('{"a":1}').error, /alarms/);
  const round = Alarms.parse(Alarms.serialize([Alarms.normalize(good)]));
  assert.equal(round.alarms[0].time, '07:00');
});

test('a one-off alarm waits for the next future occurrence', () => {
  const later = make({ time: '14:00' }, at(2026, 11, 4, 9));
  assert.equal(Alarms.pending(later), at(2026, 11, 4, 14));
  const earlier = make({ time: '07:00' }, at(2026, 11, 4, 9));
  assert.equal(Alarms.pending(earlier), at(2026, 11, 5, 7));
});

test('a repeating alarm skips days not in the list', () => {
  // Wednesday 09:00, weekdays only, time already past today -> Thursday.
  const a = make({ time: '08:00', days: [1, 2, 3, 4, 5] }, at(2026, 11, 4, 9));
  assert.equal(Alarms.pending(a), at(2026, 11, 5, 8));
  // Friday evening -> Monday.
  const b = make({ time: '08:00', days: [1, 2, 3, 4, 5] }, at(2026, 11, 6, 20));
  assert.equal(Alarms.pending(b), at(2026, 11, 9, 8));
});

test('check rings an alarm that is due, inside the late window', () => {
  const a = make({ time: '14:00' }, at(2026, 11, 4, 9));
  assert.deepEqual(Alarms.check([a], at(2026, 11, 4, 13, 59)), { ring: null, missed: [] });
  assert.deepEqual(Alarms.check([a], at(2026, 11, 4, 14)).ring, { id: 'a1', occurrence: at(2026, 11, 4, 14) });
  // Woke from suspend 40 minutes late: still rings.
  assert.deepEqual(Alarms.check([a], at(2026, 11, 4, 14, 40)).ring, { id: 'a1', occurrence: at(2026, 11, 4, 14) });
});

test('check reports an occurrence older than the window as missed', () => {
  const a = make({ time: '14:00' }, at(2026, 11, 4, 9));
  const out = Alarms.check([a], at(2026, 11, 4, 16));
  assert.equal(out.ring, null);
  assert.deepEqual(out.missed, [{ id: 'a1', occurrence: at(2026, 11, 4, 14) }]);
});

test('a repeating alarm missed for days is due once, for the latest occurrence', () => {
  const a = make({ time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }, at(2026, 11, 1, 9));
  // Shell off from Sunday to Wednesday 08:20: rings for Wednesday 08:00 only.
  const out = Alarms.check([a], at(2026, 11, 4, 8, 20));
  assert.deepEqual(out.ring, { id: 'a1', occurrence: at(2026, 11, 4, 8) });
  assert.deepEqual(out.missed, []);
  // Wednesday 12:00 instead: one missed report for Wednesday 08:00.
  assert.deepEqual(Alarms.check([a], at(2026, 11, 4, 12)).missed, [{ id: 'a1', occurrence: at(2026, 11, 4, 8) }]);
});

test('markHandled moves a repeating alarm on and switches a one-off off', () => {
  const rep = make({ time: '08:00', days: [3, 4] }, at(2026, 11, 4, 7));
  const list = Alarms.markHandled([rep], 'a1', at(2026, 11, 4, 8));
  assert.equal(list[0].enabled, true);
  assert.equal(Alarms.pending(list[0]), at(2026, 11, 5, 8));
  assert.equal(Alarms.check(list, at(2026, 11, 4, 8, 1)).ring, null);

  const once = make({ time: '08:00' }, at(2026, 11, 4, 7));
  const after = Alarms.markHandled([once], 'a1', at(2026, 11, 4, 8));
  assert.equal(after[0].enabled, false);
  assert.equal(Alarms.pending(after[0]), 0);
  assert.equal(Alarms.check(after, at(2026, 11, 4, 8, 1)).ring, null);
});

test('the earliest due alarm rings first', () => {
  const a = Alarms.create({ time: '10:00' }, at(2026, 11, 4, 9), () => 'late');
  const b = Alarms.create({ time: '09:30' }, at(2026, 11, 4, 9), () => 'early');
  assert.equal(Alarms.check([a, b], at(2026, 11, 4, 10, 5)).ring.id, 'early');
});

test('editing re-anchors: a past time does not fire right away', () => {
  const a = make({ time: '14:00' }, at(2026, 11, 4, 9));
  const edited = Alarms.update([a], 'a1', { time: '10:00' }, at(2026, 11, 4, 11));
  assert.equal(edited[0].time, '10:00');
  assert.equal(Alarms.check(edited, at(2026, 11, 4, 11)).ring, null);
  assert.equal(Alarms.pending(edited[0]), at(2026, 11, 5, 10));
});

test('setEnabled, remove and find', () => {
  const a = make({ time: '14:00' }, at(2026, 11, 4, 9));
  const off = Alarms.setEnabled([a], 'a1', false, at(2026, 11, 4, 9));
  assert.equal(Alarms.pending(off[0]), 0);
  assert.equal(Alarms.check(off, at(2026, 11, 4, 14)).ring, null);
  assert.equal(Alarms.find(off, 'a1').enabled, false);
  assert.deepEqual(Alarms.remove(off, 'a1'), []);
});

test('upcoming picks the soonest enabled alarm', () => {
  const a = Alarms.create({ time: '18:00' }, at(2026, 11, 4, 9), () => 'a');
  const b = Alarms.create({ time: '12:00', title: 'lunch' }, at(2026, 11, 4, 9), () => 'b');
  const c = Alarms.create({ time: '10:00', enabled: false }, at(2026, 11, 4, 9), () => 'c');
  const next = Alarms.upcoming([a, b, c], at(2026, 11, 4, 9));
  assert.equal(next.alarm.id, 'b');
  assert.equal(next.at, at(2026, 11, 4, 12));
  assert.equal(Alarms.upcoming([], 0), null);
});

test('daylight saving: the wall-clock time is kept', () => {
  process.env.TZ = 'America/New_York';
  try {
    // DST ends 2026-11-01 02:00 in New York.
    const a = make({ time: '07:00', days: [0, 1] }, new Date(2026, 9, 31, 12).getTime());
    const t = Alarms.pending(a);
    const d = new Date(t);
    assert.equal(d.getHours(), 7);
    assert.equal(d.getDate(), 1);
  } finally {
    process.env.TZ = 'America/Sao_Paulo';
  }
});

test('labels', () => {
  assert.equal(Alarms.describeDays([]), 'once');
  assert.equal(Alarms.describeDays([0, 1, 2, 3, 4, 5, 6]), 'every day');
  assert.equal(Alarms.describeDays([5, 4, 3, 2, 1]), 'weekdays');
  assert.equal(Alarms.describeDays([6, 0]), 'weekends');
  assert.equal(Alarms.describeDays([1, 3, 5]), 'Mon Wed Fri');
  assert.equal(Alarms.displayTitle({ title: 'standup' }), 'standup');
  assert.equal(Alarms.displayTitle({ title: '  ' }), 'ALARM');
  assert.equal(Alarms.normalizeTitle('x'.repeat(80)).length, Alarms.TITLE_MAX);
});
