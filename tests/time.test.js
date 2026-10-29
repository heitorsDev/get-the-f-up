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

const S = 1000;
const M = 60 * S;
const H = 60 * M;

// local wall-clock ms
function at(y, mo, d, h, mi, s) {
  return new Date(y, mo - 1, d, h, mi, s || 0, 0).getTime();
}

test('parseWhen: time later today', () => {
  const now = at(2026, 10, 29, 6, 0);
  assert.deepEqual(Time.parseWhen({ time: '07:30' }, now), { ringAt: at(2026, 10, 29, 7, 30), error: '' });
  assert.equal(Time.parseWhen({ time: '7:30' }, now).ringAt, at(2026, 10, 29, 7, 30));
  assert.equal(Time.parseWhen({ time: '19:05' }, now).ringAt, at(2026, 10, 29, 19, 5));
});

test('parseWhen: time already past wraps to tomorrow (past midnight)', () => {
  const now = at(2026, 10, 29, 23, 10);
  assert.equal(Time.parseWhen({ time: '07:30' }, now).ringAt, at(2026, 10, 30, 7, 30));
  // month and year rollover
  assert.equal(Time.parseWhen({ time: '06:00' }, at(2026, 12, 31, 22, 0)).ringAt, at(2027, 1, 1, 6, 0));
});

test('parseWhen: exactly now is not the future', () => {
  const now = at(2026, 10, 29, 7, 30);
  assert.equal(Time.parseWhen({ time: '07:30' }, now).ringAt, at(2026, 10, 30, 7, 30));
  assert.equal(Time.parseWhen({ time: '07:31' }, now + 30 * S).ringAt, at(2026, 10, 29, 7, 31));
});

test('parseWhen: 12h input', () => {
  const now = at(2026, 10, 29, 1, 0);
  assert.equal(Time.parseWhen({ time: '7:30am' }, now).ringAt, at(2026, 10, 29, 7, 30));
  assert.equal(Time.parseWhen({ time: '7:30 PM' }, now).ringAt, at(2026, 10, 29, 19, 30));
  assert.equal(Time.parseWhen({ time: '12:15 am' }, now).ringAt, at(2026, 10, 30, 0, 15));
  assert.equal(Time.parseWhen({ time: '12:15pm' }, now).ringAt, at(2026, 10, 29, 12, 15));
});

test('parseWhen: invalid times', () => {
  for (const t of ['24:00', '7:60', '7', 'seven', '13:00pm', '0:10am', '7:3']) {
    const r = Time.parseWhen({ time: t }, 0);
    assert.equal(r.ringAt, null, t);
    assert.match(r.error, /invalid time/, t);
  }
});

test('parseWhen: durations', () => {
  const now = at(2026, 10, 29, 22, 0);
  const cases = {
    '45m': 45 * M,
    '1h30m': 90 * M,
    '1h 30m': 90 * M,
    '90': 90 * M,
    '2h': 2 * H,
    '30s': 30 * S,
    '1h2m3s': H + 2 * M + 3 * S,
    ' 2H ': 2 * H,
  };
  for (const [d, ms] of Object.entries(cases)) {
    assert.deepEqual(Time.parseWhen({ duration: d }, now), { ringAt: now + ms, error: '' }, d);
  }
  assert.equal(Time.parseWhen({ duration: 15 }, now).ringAt, now + 15 * M);
});

test('parseWhen: invalid durations', () => {
  for (const d of ['0', '0m', 'abc', '1x', 'm', '-5', -5, 0]) {
    const r = Time.parseWhen({ duration: d }, 0);
    assert.equal(r.ringAt, null, String(d));
    assert.match(r.error, /invalid duration/, String(d));
  }
});

test('parseWhen: needs exactly one of time/duration', () => {
  assert.match(Time.parseWhen({}, 0).error, /missing/);
  assert.match(Time.parseWhen(null, 0).error, /missing/);
  assert.match(Time.parseWhen({ time: '', duration: '' }, 0).error, /missing/);
  assert.match(Time.parseWhen({ time: '07:00', duration: '5m' }, 0).error, /not both/);
});

test('parseWhen: crosses a DST change by wall clock', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    // DST ends 2026-10-25 03:00 -> 02:00 in Berlin
    const now = at(2026, 10, 24, 23, 0);
    const r = Time.parseWhen({ time: '07:30' }, now);
    const d = new Date(r.ringAt);
    assert.equal(d.getDate(), 25);
    assert.equal(d.getHours(), 7);
    assert.equal(d.getMinutes(), 30);
    assert.equal(r.ringAt - now, 9.5 * H);
  } finally {
    process.env.TZ = prev;
  }
});

test('formatClock', () => {
  const t = at(2026, 10, 29, 7, 14, 22);
  assert.equal(Time.formatClock(t), '07:14:22');
  assert.equal(Time.formatClock(t, { h24: true, seconds: false }), '07:14');
  assert.equal(Time.formatClock(t, { h24: false }), '7:14:22 AM');
  assert.equal(Time.formatClock(t, { h24: false, seconds: false }), '7:14 AM');
  assert.equal(Time.formatClock(at(2026, 10, 29, 19, 5, 0), { h24: false }), '7:05:00 PM');
  assert.equal(Time.formatClock(at(2026, 10, 29, 0, 0, 9), { h24: false }), '12:00:09 AM');
  assert.equal(Time.formatClock(at(2026, 10, 29, 12, 30, 0), { h24: false, seconds: false }), '12:30 PM');
  assert.equal(Time.formatClock(at(2026, 10, 29, 0, 5, 0), { seconds: false }), '00:05');
});

test('formatDate', () => {
  assert.equal(Time.formatDate(at(2026, 10, 29, 7, 0)), 'Thu 29 Oct');
  assert.equal(Time.formatDate(at(2027, 1, 3, 7, 0)), 'Sun 3 Jan');
});

test('formatCountdown', () => {
  assert.equal(Time.formatCountdown(6 * H + 15 * M), '6h 15m');
  assert.equal(Time.formatCountdown(6 * H + 15 * M + 59 * S), '6h 15m');
  assert.equal(Time.formatCountdown(2 * H), '2h 0m');
  assert.equal(Time.formatCountdown(15 * M + 30 * S), '15m');
  assert.equal(Time.formatCountdown(42 * S), '42s');
  assert.equal(Time.formatCountdown(41 * S + 1), '42s');
  assert.equal(Time.formatCountdown(59 * S + 500), '1m');
  assert.equal(Time.formatCountdown(0), '0s');
  assert.equal(Time.formatCountdown(-5000), '0s');
  assert.equal(Time.formatCountdown(NaN), '0s');
});

test('formatCompact', () => {
  assert.equal(Time.formatCompact(6 * H + 18 * M), '6h18m');
  assert.equal(Time.formatCompact(15 * M), '15m');
  assert.equal(Time.formatCompact(42 * S), '42s');
});

test('formatElapsed', () => {
  assert.equal(Time.formatElapsed(3 * M + 12 * S), '+3m 12s');
  assert.equal(Time.formatElapsed(3 * M + 12 * S + 999), '+3m 12s');
  assert.equal(Time.formatElapsed(42 * S), '+42s');
  assert.equal(Time.formatElapsed(0), '+0s');
  assert.equal(Time.formatElapsed(H + 4 * M + 5 * S), '+1h 4m');
});

test('formatDuration', () => {
  assert.equal(Time.formatDuration(6 * H + 12 * M + 40 * S), '6h 12m');
  assert.equal(Time.formatDuration(12 * M), '12m');
  assert.equal(Time.formatDuration(42 * S), '42s');
  assert.equal(Time.formatDuration(0), '0s');
});
