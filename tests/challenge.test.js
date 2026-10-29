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

const Steps = load('Steps.js');
const Config = load('Config.js');
const Challenge = load('Challenge.js', { Steps });

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAM = Config.defaults().camera;
const LIGHT = { luma: 120, variance: 300, error: null };
const DARK = { luma: 40, variance: 50, error: null };
const BLACK = { luma: 16, variance: 0, error: null };
const M = { type: 'math' }; // shuffled presets only count their authored steps

// Answers whatever the current step is, correctly.
function solve(state, rng) {
  if (state.current.type === 'camera') return Challenge.submitCamera(state, LIGHT, CAM, rng).state;
  return Challenge.submit(state, state.current.expected, rng).state;
}

// The camera is an optional gate now, not a default step, but the engine still
// runs camera steps from custom presets. These tests keep a legacy preset
// (camera + 3 math) and pool entry so that path stays covered.
const LEGACY_CAMERA = {
  challenge: {
    // Config.merge replaces the whole presets map, so start from the full set.
    presets: Object.assign({}, Config.defaults().challenge.presets, { thorough: { shuffle: false, steps: [{ type: 'camera' }, { type: 'math', operators: '+-x', maxOperand: 20, tier: 'easy' }, { type: 'math', operators: '+-x', maxOperand: 20, tier: 'easy' }, { type: 'math', operators: '+-x', maxOperand: 20, tier: 'easy' }] } }),
    pool: Object.assign({}, Config.defaults().challenge.pool, { camera: { weight: 1 } })
  }
};

function layer(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && out[k] && typeof out[k] === 'object') out[k] = layer(out[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}

function config(partial) {
  return Config.merge(layer(LEGACY_CAMERA, partial || {}));
}

test('Challenge.js imports Steps for QML', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'Challenge.js'), 'utf8').split('\n');
  assert.equal(lines[0], '.pragma library');
  assert.equal(lines[1], '.import "Steps.js" as Steps');
});

test('resolvePreset: "default" and empty name use challenge.defaultPreset', () => {
  const c = config();
  for (const name of ['default', '', null, undefined]) {
    const r = Challenge.resolvePreset(c, name, seeded(1));
    assert.equal(r.name, 'standard');
    assert.equal(r.shuffled, false);
    assert.equal(r.steps.length, 3);
  }
});

test('resolvePreset: unknown preset is null', () => {
  assert.equal(Challenge.resolvePreset(config(), 'nope', seeded(1)), null);
});

test('resolvePreset: fixed preset keeps order and stamps the global camera threshold', () => {
  const r = Challenge.resolvePreset(config({ camera: { lightThreshold: 75 } }), 'thorough', seeded(1));
  assert.deepEqual(r.steps.map((s) => s.type), ['camera', 'math', 'math', 'math']);
  assert.equal(r.steps[0].threshold, 75);
  // The threshold is global: a number on the step itself is overwritten.
  const own = config({ camera: { lightThreshold: 75 }, challenge: { presets: { p: { steps: [{ type: 'camera', threshold: 90 }] } } } });
  assert.equal(Challenge.resolvePreset(own, 'p').steps[0].threshold, 75);
});

test('resolvePreset: camera disabled drops camera steps', () => {
  const r = Challenge.resolvePreset(config({ camera: { enabled: false } }), 'thorough', seeded(1));
  assert.deepEqual(r.steps.map((s) => s.type), ['math', 'math', 'math']);
});

test('resolvePreset: empty or invalid steps fall back to one easy math step', () => {
  const c = config({
    camera: { enabled: false },
    challenge: { presets: { cam: { steps: [{ type: 'camera' }] }, bad: { steps: [{ type: 'dance' }] } } },
  });
  assert.deepEqual(Challenge.resolvePreset(c, 'cam').steps, [Challenge.FALLBACK_STEP]);
  assert.deepEqual(Challenge.resolvePreset(c, 'bad').steps, [Challenge.FALLBACK_STEP]);
});

test('resolvePreset: shuffle draws len(steps) specs from the pool', () => {
  const c = config({ challenge: { presets: { mix: { shuffle: true, steps: [{ type: 'math' }, { type: 'math' }, { type: 'math' }] } } } });
  const r = Challenge.resolvePreset(c, 'mix', seeded(7));
  assert.equal(r.shuffled, true);
  assert.equal(r.steps.length, 3);
  assert.equal(r.drawCount, 3);
  assert.ok(r.steps.every((s) => Steps.TYPES.includes(s.type)));
  assert.ok(r.steps.every((s) => !('weight' in s)));
  assert.deepEqual(r.pool.map((p) => p.spec.type).sort(), ['camera', 'math', 'memory', 'string']);
  const math = r.pool.find((p) => p.spec.type === 'math');
  assert.deepEqual(math, { weight: 3, spec: { type: 'math', operators: '+-x', maxOperand: 20 } });
});

test('shuffle distribution follows pool weights (3:2:1:1)', () => {
  const c = config({ challenge: { presets: { mix: { shuffle: true, steps: [{ type: 'math' }] } } } });
  const rng = seeded(2024);
  const counts = { math: 0, string: 0, memory: 0, camera: 0 };
  const N = 14000;
  for (let i = 0; i < N; i++) counts[Challenge.resolvePreset(c, 'mix', rng).steps[0].type]++;
  const expect = { math: 3 / 7, string: 2 / 7, memory: 1 / 7, camera: 1 / 7 };
  for (const t of Object.keys(expect)) {
    assert.ok(Math.abs(counts[t] / N - expect[t]) < 0.02, `${t}: ${counts[t] / N} vs ${expect[t]}`);
  }
});

test('shuffle: camera never drawn when camera disabled; zero weights excluded', () => {
  const c = config({
    camera: { enabled: false },
    challenge: { pool: { memory: { weight: 0 } }, presets: { mix: { shuffle: true, steps: [M, M, M, M] } } },
  });
  const rng = seeded(5);
  for (let i = 0; i < 500; i++) {
    const r = Challenge.resolvePreset(c, 'mix', rng);
    assert.ok(r.steps.every((s) => s.type === 'math' || s.type === 'string'));
  }
});

test('shuffle: empty pool falls back to math', () => {
  const c = config({ challenge: { pool: { math: { weight: 0 }, string: { weight: 0 }, memory: { weight: 0 }, camera: { weight: 0 } }, presets: { mix: { shuffle: true, steps: [] } } } });
  const r = Challenge.resolvePreset(c, 'mix', seeded(1));
  assert.deepEqual(r.steps, [Challenge.FALLBACK_STEP]);
});

test('removeCameraSteps: fixed preset', () => {
  const r = Challenge.resolvePreset(config(), 'thorough', seeded(1));
  const out = Challenge.removeCameraSteps(r);
  assert.deepEqual(out.steps.map((s) => s.type), ['math', 'math', 'math']);
  assert.equal(r.steps.length, 4, 'input untouched');
  const only = Challenge.removeCameraSteps({ name: 'x', steps: [{ type: 'camera' }], shuffled: false });
  assert.deepEqual(only.steps, [Challenge.FALLBACK_STEP]);
});

test('removeCameraSteps: shuffled preset keeps step count and drops camera from pool', () => {
  const c = config({ challenge: { pool: { camera: { weight: 100 } }, presets: { mix: { shuffle: true, steps: [M, M, M] } } } });
  const r = Challenge.resolvePreset(c, 'mix', seeded(3));
  assert.ok(r.steps.some((s) => s.type === 'camera'));
  const out = Challenge.removeCameraSteps(r);
  assert.equal(out.steps.length, 3);
  assert.ok(out.steps.every((s) => s.type !== 'camera'));
  assert.ok(out.pool.every((p) => p.spec.type !== 'camera'));
  // later reps re-draw from the camera-free pool
  let s = Challenge.create(out, 5, seeded(4));
  while (!s.done) {
    assert.notEqual(s.current.type, 'camera');
    s = solve(s, seeded(s.completedSteps + 10));
  }
});

test('create + view: initial state', () => {
  const r = Challenge.resolvePreset(config(), 'thorough', seeded(1));
  const s = Challenge.create(r, 2, seeded(1));
  const v = Challenge.view(s);
  assert.equal(v.type, 'camera');
  assert.deepEqual(v.instance, { type: 'camera', threshold: 60 });
  assert.equal(v.rep, 0);
  assert.equal(v.reps, 2);
  assert.equal(v.stepIndex, 0);
  assert.equal(v.stepCount, 4);
  assert.equal(v.completedSteps, 0);
  assert.equal(v.totalSteps, 8);
  assert.equal(v.errors, 0);
  assert.equal(v.done, false);
  assert.equal(v.presetName, 'thorough');
  assert.equal(v.description, 'camera · light check');
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v, 'view is plain JSON');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'state is plain JSON');
  assert.equal(Challenge.view(null), null);
});

test('create: reps clamps to >= 1', () => {
  const r = Challenge.resolvePreset(config(), 'quick');
  assert.equal(Challenge.create(r, 0).reps, 1);
  assert.equal(Challenge.create(r, undefined).reps, 1);
  assert.equal(Challenge.create(r, 3.9).reps, 3);
});

test('N accounting: N=2 on a 4-step preset takes exactly 8 steps', () => {
  const r = Challenge.resolvePreset(config(), 'thorough', seeded(1));
  let s = Challenge.create(r, 2, seeded(2));
  let steps = 0;
  const seenReps = [];
  while (!s.done) {
    seenReps.push(`${s.rep}:${s.stepIndex}`);
    s = solve(s, seeded(100 + steps));
    steps++;
    assert.ok(steps <= 8);
  }
  assert.equal(steps, 8);
  assert.deepEqual(seenReps, ['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3']);
  const v = Challenge.view(s);
  assert.equal(v.done, true);
  assert.equal(v.completedSteps, 8);
  assert.equal(v.rep, 2);
  assert.equal(v.type, null);
  assert.equal(v.instance, null);
});

test('a wrong answer keeps progress, counts an error and re-randomizes math', () => {
  const r = Challenge.resolvePreset(config(), 'standard', seeded(1));
  let s = Challenge.create(r, 1, seeded(9));
  s = solve(s, seeded(10));
  assert.equal(s.stepIndex, 1);
  const before = s.current;
  const prompts = new Set();
  for (let i = 0; i < 5; i++) {
    const res = Challenge.submit(s, 'not a number', seeded(200 + i));
    assert.equal(res.correct, false);
    assert.equal(res.state.stepIndex, 1, 'progress kept');
    assert.equal(res.state.completedSteps, 1);
    assert.equal(res.state.errors, s.errors + 1);
    prompts.add(res.state.current.prompt);
    s = res.state;
  }
  assert.equal(s.errors, 5);
  assert.ok(prompts.size > 1, 'math problem re-randomized');
  assert.notDeepEqual(s.current, before);
  // errors never block completion
  while (!s.done) s = solve(s, seeded(1));
  assert.equal(Challenge.view(s).errors, 5);
});

test('wrong string/memory answers keep the same instance', () => {
  const c = config({ challenge: { presets: { p: { steps: [{ type: 'string' }, { type: 'memory' }] } } } });
  let s = Challenge.create(Challenge.resolvePreset(c, 'p'), 1, seeded(1));
  let res = Challenge.submit(s, 'wrong', seeded(2));
  assert.deepEqual(res.state.current, s.current);
  s = solve(res.state, seeded(3));
  res = Challenge.submit(s, '', seeded(4));
  assert.deepEqual(res.state.current, s.current);
  assert.equal(res.state.errors, 2);
});

test('state is immutable', () => {
  const s = Challenge.create(Challenge.resolvePreset(config(), 'standard'), 1, seeded(1));
  const snapshot = JSON.stringify(s);
  Challenge.submit(s, s.current.expected, seeded(2));
  Challenge.submit(s, 'x', seeded(2));
  assert.equal(JSON.stringify(s), snapshot);
});

test('submit on a camera step or a done state is a no-op', () => {
  let s = Challenge.create(Challenge.resolvePreset(config(), 'thorough'), 1, seeded(1));
  let res = Challenge.submit(s, '60');
  assert.equal(res.correct, false);
  assert.equal(res.state.errors, 0);
  while (!s.done) s = solve(s, seeded(1));
  res = Challenge.submit(s, 'x');
  assert.equal(res.correct, false);
  assert.equal(res.state.done, true);
  const cam = Challenge.submitCamera(s, LIGHT, CAM);
  assert.equal(cam.reason, 'not-camera');
});

test('shuffled presets re-draw steps for each rep', () => {
  const c = config({ challenge: { presets: { mix: { shuffle: true, steps: [M, M, M, M] } } } });
  const rng = seeded(77);
  let s = Challenge.create(Challenge.resolvePreset(c, 'mix', rng), 6, rng);
  const perRep = [];
  let last = -1;
  while (!s.done) {
    if (s.rep !== last) {
      perRep.push(s.steps.map((x) => x.type).join(','));
      last = s.rep;
    }
    assert.equal(s.steps.length, 4);
    s = solve(s, rng);
  }
  assert.equal(perRep.length, 6);
  assert.ok(new Set(perRep).size > 1, 'reps differ: ' + perRep.join(' | '));
  assert.equal(s.completedSteps, 24);
});

function cameraState(autoSkip) {
  const c = config({ camera: { autoSkipAfterFailures: autoSkip }, challenge: { presets: { p: { steps: [{ type: 'camera' }, { type: 'string' }] } } } });
  return Challenge.create(Challenge.resolvePreset(c, 'p'), 1, seeded(1));
}

test('camera: light on passes', () => {
  const res = Challenge.submitCamera(cameraState(3), LIGHT, CAM, seeded(1));
  assert.deepEqual([res.correct, res.skipped, res.reason], [true, false, 'light']);
  assert.equal(res.state.stepIndex, 1);
  assert.equal(res.state.current.type, 'string');
  // threshold is inclusive
  const edge = Challenge.submitCamera(cameraState(3), { luma: 60, variance: 10, error: null }, CAM);
  assert.equal(edge.correct, true);
});

test('camera: dark room fails and keeps the step', () => {
  const s = cameraState(3);
  const res = Challenge.submitCamera(s, DARK, CAM, seeded(1));
  assert.deepEqual([res.correct, res.skipped, res.reason], [false, false, 'dark']);
  assert.equal(res.state.stepIndex, 0);
  assert.equal(res.state.errors, 1);
  assert.equal(res.state.cameraFailures, 1);
});

test('camera: error or missing luma is skipped as unavailable', () => {
  for (const reading of [
    { luma: null, variance: null, error: 'EACCES' },
    { luma: 120, variance: 10, error: 'device busy' },
    { luma: null, variance: null, error: null },
    null,
  ]) {
    const res = Challenge.submitCamera(cameraState(3), reading, CAM);
    assert.deepEqual([res.correct, res.skipped, res.reason], [true, true, 'unavailable'], JSON.stringify(reading));
    assert.equal(res.state.stepIndex, 1, 'skip counts as passed');
    assert.equal(res.state.completedSteps, 1);
    assert.equal(res.state.errors, 0);
    assert.equal(res.state.cameraDemotions, 0);
  }
});

test('camera: near-black with flat frame is skipped as blocked', () => {
  for (const reading of [BLACK, { luma: 23.9, variance: 0.5, error: null }, { luma: 16, variance: null, error: null }]) {
    const res = Challenge.submitCamera(cameraState(3), reading, CAM);
    assert.deepEqual([res.correct, res.skipped, res.reason], [true, true, 'blocked'], JSON.stringify(reading));
  }
  // dark but noisy is a real (dark) room, not a blocked lens
  const noisy = Challenge.submitCamera(cameraState(3), { luma: 18, variance: 40, error: null }, CAM);
  assert.equal(noisy.reason, 'dark');
  // at the cutoff is not near-black
  const atCutoff = Challenge.submitCamera(cameraState(3), { luma: 24, variance: 0, error: null }, CAM);
  assert.equal(atCutoff.reason, 'dark');
});

test('camera: auto-skip after N consecutive failures demotes the step', () => {
  let s = cameraState(3);
  let res = Challenge.submitCamera(s, DARK, CAM);
  res = Challenge.submitCamera(res.state, DARK, CAM);
  assert.equal(res.reason, 'dark');
  assert.equal(res.state.cameraFailures, 2);
  res = Challenge.submitCamera(res.state, DARK, CAM);
  assert.deepEqual([res.correct, res.skipped, res.reason], [true, true, 'demoted']);
  assert.equal(res.state.cameraDemotions, 1);
  assert.equal(res.state.errors, 3);
  assert.equal(res.state.stepIndex, 1);
  assert.equal(res.state.cameraFailures, 0, 'reset after leaving the step');
});

test('camera: failures must be consecutive within the step', () => {
  const c = config({ challenge: { presets: { p: { steps: [{ type: 'camera' }, { type: 'camera' }] } } } });
  let s = Challenge.create(Challenge.resolvePreset(c, 'p'), 1, seeded(1));
  s = Challenge.submitCamera(s, DARK, CAM).state;
  s = Challenge.submitCamera(s, DARK, CAM).state;
  s = Challenge.submitCamera(s, LIGHT, CAM).state; // passes step 0
  assert.equal(s.stepIndex, 1);
  const res = Challenge.submitCamera(s, DARK, CAM);
  assert.equal(res.reason, 'dark');
  assert.equal(res.state.cameraFailures, 1);
});

test('camera: autoSkipAfterFailures 0 never auto-skips', () => {
  let s = cameraState(0);
  const cfg = Object.assign({}, CAM, { autoSkipAfterFailures: 0 });
  for (let i = 0; i < 50; i++) {
    const res = Challenge.submitCamera(s, DARK, cfg);
    assert.equal(res.reason, 'dark');
    s = res.state;
  }
  assert.equal(s.stepIndex, 0);
  assert.equal(s.cameraDemotions, 0);
  // but an unusable camera still skips
  assert.equal(Challenge.submitCamera(s, BLACK, cfg).skipped, true);
});

test('camera: config threshold applies when the instance has none', () => {
  const s = Challenge.create({ name: 'x', steps: [{ type: 'camera' }], shuffled: false }, 1);
  s.current = { type: 'camera' };
  assert.equal(Challenge.submitCamera(s, { luma: 80, variance: 9, error: null }, { lightThreshold: 90 }).reason, 'dark');
  assert.equal(Challenge.submitCamera(s, { luma: 95, variance: 9, error: null }, { lightThreshold: 90 }).reason, 'light');
  assert.equal(Challenge.submitCamera(s, { luma: 61, variance: 9, error: null }, null).reason, 'light');
});

test('camera: the global threshold decides, whatever the step or instance carries', () => {
  const cfg = config({ camera: { lightThreshold: 75 }, challenge: { presets: { p: { steps: [{ type: 'camera', threshold: 200 }] } } } });
  const s = Challenge.create(Challenge.resolvePreset(cfg, 'p'), 1);
  // luma 80 passes the global 75 even though the step said 200
  assert.equal(Challenge.submitCamera(s, { luma: 80, variance: 9, error: null }, { lightThreshold: 75 }).reason, 'light');
  // and a later change of the global value applies at once, to the same step
  assert.equal(Challenge.submitCamera(s, { luma: 80, variance: 9, error: null }, { lightThreshold: 120 }).reason, 'dark');
});
