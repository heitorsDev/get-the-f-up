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
const Steps = load('Steps.js');
const Config = load('Config.js');
const Challenge = load('Challenge.js', { Steps });
const History = load('History.js', { Time });

const M = 60 * 1000;
const H = 60 * M;
const T0 = Date.UTC(2026, 9, 28, 1, 0, 0);

const session = { armedAt: T0, ringAt: T0 + 6 * H + 12 * M, ringingSince: null, preset: 'thorough', reps: 3, dryRun: false };

test('History.js imports Time for QML', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'History.js'), 'utf8').split('\n');
  assert.equal(lines[0], '.pragma library');
  assert.equal(lines[1], '.import "Time.js" as Time');
});

test('parse: valid, bad and empty input', () => {
  assert.deepEqual(History.parse('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(History.parse('[{"a":1}, 3, null, []]'), [{ a: 1 }]);
  for (const bad of ['', '   ', '{', '{"a":1}', '42', null, undefined]) assert.deepEqual(History.parse(bad), [], String(bad));
});

test('serialize round-trips', () => {
  const list = [{ a: 1 }];
  assert.deepEqual(History.parse(History.serialize(list)), list);
  assert.ok(History.serialize(list).endsWith('\n'));
  assert.equal(History.serialize(null).trim(), '[]');
});

test('makeRecord: exact shape from session + engine state', () => {
  const c = Config.merge({});
  let s = Challenge.create(Challenge.resolvePreset(c, 'quick'), 3, Math.random);
  s = Challenge.submit(s, 'wrong').state;
  while (!s.done) s = Challenge.submit(s, s.current.expected).state;
  const exitAt = session.ringAt + 4 * M;
  const rec = History.makeRecord(session, exitAt, s);
  assert.deepEqual(rec, {
    armedAt: T0,
    ringAt: session.ringAt,
    exitAt,
    preset: 'thorough',
    challengesRequired: 3,
    challengesCompleted: 3,
    errors: 1,
    cameraDemotions: 0,
    exitedBeforeRing: false,
  });
  assert.deepEqual(Object.keys(rec), [
    'armedAt', 'ringAt', 'exitAt', 'preset', 'challengesRequired',
    'challengesCompleted', 'errors', 'cameraDemotions', 'exitedBeforeRing',
  ]);
  // the same works from a Challenge.view
  assert.deepEqual(History.makeRecord(session, exitAt, Challenge.view(s)), rec);
});

test('makeRecord: early exit and progress on the session object', () => {
  const rec = History.makeRecord(
    Object.assign({}, session, { challenge: { rep: 3, reps: 3, done: true, errors: 2, cameraDemotions: 1 } }),
    T0 + 2 * H,
  );
  assert.equal(rec.exitedBeforeRing, true);
  assert.equal(rec.challengesCompleted, 3);
  assert.equal(rec.errors, 2);
  assert.equal(rec.cameraDemotions, 1);
  const bare = History.makeRecord({ armedAt: 1, ringAt: 10, preset: 'x', reps: 2 }, 5);
  assert.equal(bare.challengesCompleted, 0);
  assert.equal(bare.errors, 0);
  assert.equal(bare.challengesRequired, 2);
});

test('append drops the oldest past max (default 500)', () => {
  let list = [];
  for (let i = 0; i < 505; i++) list = History.append(list, { i });
  assert.equal(list.length, 500);
  assert.equal(list[0].i, 5);
  assert.equal(list[499].i, 504);
  const small = History.append([{ i: 1 }, { i: 2 }, { i: 3 }], { i: 4 }, 2);
  assert.deepEqual(small, [{ i: 3 }, { i: 4 }]);
  const orig = [{ i: 1 }];
  History.append(orig, { i: 2 });
  assert.equal(orig.length, 1, 'input untouched');
  assert.deepEqual(History.append(null, { i: 1 }), [{ i: 1 }]);
});

test('recent: last n, newest first', () => {
  const list = Array.from({ length: 15 }, (_, i) => ({ i }));
  assert.deepEqual(History.recent(list, 3).map((r) => r.i), [14, 13, 12]);
  assert.equal(History.recent(list).length, 10);
  assert.deepEqual(History.recent([{ i: 0 }], 10).map((r) => r.i), [0]);
  assert.deepEqual(History.recent(list, 0), []);
  assert.equal(list[0].i, 0, 'input untouched');
});

test('totals: sessions, time slept (arm -> min(ring, exit)), early exits', () => {
  const list = [
    History.makeRecord(session, session.ringAt + 30 * M), // slept 6h12m, rang
    History.makeRecord({ armedAt: T0, ringAt: T0 + 8 * H, reps: 1 }, T0 + 2 * H), // early, 2h
  ];
  assert.deepEqual(History.totals(list), { sessions: 2, sleptMs: 8 * H + 12 * M, earlyExits: 1 });
  assert.deepEqual(History.totals([]), { sessions: 0, sleptMs: 0, earlyExits: 0 });
  assert.deepEqual(History.totals(null), { sessions: 0, sleptMs: 0, earlyExits: 0 });
});

test('summary text', () => {
  const rec = { armedAt: T0, ringAt: T0 + 6 * H + 12 * M, exitAt: T0 + 6 * H + 20 * M, challengesCompleted: 3, errors: 1, cameraDemotions: 0, exitedBeforeRing: false };
  assert.equal(History.summary(rec), 'Slept 6h 12m — 3 challenges, 1 error');
  assert.equal(
    History.summary(Object.assign({}, rec, { challengesCompleted: 1, errors: 0, cameraDemotions: 2 })),
    'Slept 6h 12m — 1 challenge, 0 errors, 2 camera skips',
  );
  assert.equal(
    History.summary(Object.assign({}, rec, { exitAt: T0 + 45 * M, exitedBeforeRing: true })),
    'Slept 45m, up before the alarm — 3 challenges, 1 error',
  );
});
