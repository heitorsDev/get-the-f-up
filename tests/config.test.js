const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// QML JS modules start with `.pragma library` (and may `.import` siblings),
// which Node cannot parse. Blank those lines out (keeping line numbers) and
// evaluate the rest in this realm, injecting imported modules by qualifier.
function load(name, deps) {
  const file = path.join(__dirname, '..', name);
  const src = fs.readFileSync(file, 'utf8').replace(/^[ \t]*\.(pragma|import)\b.*$/gm, '');
  const mod = { exports: {} };
  const names = Object.keys(deps || {});
  const fn = new Function('module', 'exports', ...names, src + '\n//# sourceURL=' + file);
  fn(mod, mod.exports, ...names.map((n) => deps[n]));
  return mod.exports;
}

const Config = load('Config.js');

test('line 1 is .pragma library', () => {
  const first = fs.readFileSync(path.join(__dirname, '..', 'Config.js'), 'utf8').split('\n')[0];
  assert.equal(first, '.pragma library');
});

test('defaults match the SPEC §16 shape', () => {
  const d = Config.defaults();
  assert.equal(d.version, 1);
  assert.equal(d.display.dimMethod, 'gamma');
  assert.equal(d.display.gammaPercent, 50);
  assert.equal(d.audio.soundPath, null);
  assert.equal(d.audio.volumePercent, 80);
  assert.equal(d.camera.lightThreshold, 60);
  assert.equal(d.camera.nearBlackCutoff, 24);
  assert.equal(d.camera.autoSkipAfterFailures, 3);
  assert.equal(d.challenge.defaultPreset, 'standard');
  assert.equal(d.challenge.reps, 1);
  assert.deepEqual(Object.keys(d.challenge.presets), ['standard', 'thorough', 'quick']);
  assert.equal(d.challenge.presets.standard.steps.length, 3);
  assert.ok(d.challenge.presets.standard.steps.every((s) => s.type === 'math'));
  assert.deepEqual(d.challenge.presets.thorough.steps.map((s) => s.type), ['string', 'math', 'math', 'math']);
  // The camera is an optional gate, not a default step.
  assert.equal(d.camera.requireLight, false);
  assert.ok(!d.challenge.presets.thorough.steps.some((s) => s.type === 'camera'));
  assert.equal(d.challenge.pool.camera, undefined);
  assert.deepEqual(d.challenge.presets.quick.steps, [{ type: 'string', charset: 'alnum', length: 8 }]);
  assert.equal(d.challenge.pool.math.weight, 3);
  assert.equal(d.lockdown.maxDurationMinutes, 0);
  assert.equal(d.ui.palette, 'theme');
  assert.equal(d.ui.claudePalette.accent, '#d97757');
  assert.equal(d.safety.emergencyExit, false);
  assert.equal(d.safety.watchdog, true);
});

test('defaults returns a fresh copy every call', () => {
  const a = Config.defaults();
  a.display.gammaPercent = 1;
  a.challenge.presets.standard.steps.push({ type: 'camera' });
  const b = Config.defaults();
  assert.equal(b.display.gammaPercent, 50);
  assert.equal(b.challenge.presets.standard.steps.length, 3);
});

test('merge of nothing is defaults', () => {
  assert.deepEqual(Config.merge(undefined), Config.defaults());
  assert.deepEqual(Config.merge({}), Config.defaults());
  assert.deepEqual(Config.merge(null), Config.defaults());
});

test('merge deep-merges nested objects and keeps missing keys', () => {
  const c = Config.merge({ display: { gammaPercent: 30 }, ui: { claudePalette: { accent: '#ff0000' } } });
  assert.equal(c.display.gammaPercent, 30);
  assert.equal(c.display.restoreBrightness, true);
  assert.equal(c.ui.claudePalette.accent, '#ff0000');
  assert.equal(c.ui.claudePalette.foreground, '#f0eee6');
  assert.equal(c.ui.clock24h, true);
});

test('merge ignores values of the wrong type', () => {
  const c = Config.merge({ display: 'nope', camera: { lightThreshold: 'bright', enabled: 'yes' }, ui: { clock24h: 0 } });
  assert.deepEqual(c.display, Config.defaults().display);
  assert.equal(c.camera.lightThreshold, 60);
  assert.equal(c.camera.enabled, true);
  assert.equal(c.ui.clock24h, true);
});

test('merge accepts string or null for nullable keys', () => {
  assert.equal(Config.merge({ audio: { soundPath: '/a.oga' } }).audio.soundPath, '/a.oga');
  assert.equal(Config.merge({ audio: { sink: null } }).audio.sink, null);
  assert.equal(Config.merge({ audio: { sink: 42 } }).audio.sink, Config.defaults().audio.sink);
});

test('merge keeps unknown keys for forward compatibility', () => {
  const c = Config.merge({ future: { x: 1 }, display: { extra: true } });
  assert.deepEqual(c.future, { x: 1 });
  assert.equal(c.display.extra, true);
});

test('arrays replace instead of merging', () => {
  const c = Config.merge({ challenge: { presets: { standard: { steps: [{ type: 'memory', length: 6 }] } } } });
  assert.deepEqual(c.challenge.presets.standard.steps, [{ type: 'memory', length: 6 }]);
});

test('presets replace as a whole, entries are taken verbatim', () => {
  const c = Config.merge({
    challenge: { presets: { mine: { shuffle: true, steps: [{ type: 'math' }] }, standard: { steps: [] } } },
  });
  assert.deepEqual(Config.presetNames(c), ['mine', 'standard']);
  assert.deepEqual(c.challenge.presets.mine, { shuffle: true, steps: [{ type: 'math' }] });
  // not merged with the default "standard" (which has 3 math steps)
  assert.deepEqual(c.challenge.presets.standard, { shuffle: false, steps: [] });
});

test('presets drop malformed steps and fix defaultPreset', () => {
  const c = Config.merge({
    challenge: { defaultPreset: 'gone', presets: { only: { steps: [{ type: 'math' }, 5, null, { nope: 1 }] } } },
  });
  assert.deepEqual(c.challenge.presets.only.steps, [{ type: 'math' }]);
  assert.equal(c.challenge.defaultPreset, 'only');
});

test('an empty presets object falls back to the default presets', () => {
  const c = Config.merge({ challenge: { presets: {} } });
  assert.deepEqual(c.challenge.presets, Config.defaults().challenge.presets);
});

test('pool entries deep-merge', () => {
  const c = Config.merge({ challenge: { pool: { math: { weight: 10 } } } });
  assert.equal(c.challenge.pool.math.weight, 10);
  assert.equal(c.challenge.pool.math.operators, '+-x');
  assert.equal(c.challenge.pool.string.weight, 2);
});

test('reps is clamped to a positive integer', () => {
  assert.equal(Config.merge({ challenge: { reps: 0 } }).challenge.reps, 1);
  assert.equal(Config.merge({ challenge: { reps: 2.7 } }).challenge.reps, 2);
});

test('parse: partial file is valid', () => {
  const r = Config.parse('{"camera":{"enabled":false}}');
  assert.equal(r.error, '');
  assert.equal(r.config.camera.enabled, false);
  assert.equal(r.config.camera.lightThreshold, 60);
  assert.equal(r.config.challenge.defaultPreset, 'standard');
});

test('parse: bad JSON yields defaults and an error', () => {
  const r = Config.parse('{"camera": ');
  assert.deepEqual(r.config, Config.defaults());
  assert.match(r.error, /not valid JSON/);
});

test('parse: empty and non-object input yield defaults and an error', () => {
  for (const text of ['', '   \n', null, undefined]) {
    const r = Config.parse(text);
    assert.deepEqual(r.config, Config.defaults());
    assert.ok(r.error.length > 0);
  }
  for (const text of ['[]', '42', '"x"', 'null']) {
    const r = Config.parse(text);
    assert.deepEqual(r.config, Config.defaults());
    assert.match(r.error, /JSON object/);
  }
});

test('serialize round-trips with 2-space indent and trailing newline', () => {
  const c = Config.merge({ display: { gammaPercent: 40 } });
  const s = Config.serialize(c);
  assert.ok(s.endsWith('}\n'));
  assert.ok(s.startsWith('{\n  "version": 1,'));
  assert.deepEqual(Config.parse(s).config, c);
});

test('paths', () => {
  assert.equal(Config.configPath('/home/u'), '/home/u/.config/omarchy/get-the-f-up/config.json');
  assert.equal(Config.stateDir('/home/u'), '/home/u/.local/state/omarchy/get-the-f-up');
  assert.equal(Config.historyPath('/home/u'), '/home/u/.local/state/omarchy/get-the-f-up/history.json');
  assert.equal(Config.activePath('/home/u'), '/home/u/.local/state/omarchy/get-the-f-up/active.json');
});

test('presetNames', () => {
  assert.deepEqual(Config.presetNames(Config.defaults()), ['standard', 'thorough', 'quick']);
  assert.deepEqual(Config.presetNames(null), []);
});
