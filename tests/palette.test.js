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

const Palette = load('Palette.js');

// SPEC.md §3 — the Claude Code preset.
const CLAUDE = {
  background: '#000000',
  foreground: '#f0eee6',
  dim: '#8f8f88',
  accent: '#d97757',
  border: '#3a3a37',
  error: '#cc6666',
  success: '#6a9bcc'
};

test('line 1 is .pragma library', () => {
  const first = fs.readFileSync(path.join(__dirname, '..', 'Palette.js'), 'utf8').split('\n')[0];
  assert.equal(first, '.pragma library');
});

test('the module exports every documented function', () => {
  for (const name of ['TOKENS', 'claudePreset', 'fromTheme', 'resolve', 'normalizeColor']) {
    assert.ok(Palette[name] !== undefined, 'missing export: ' + name);
  }
});

test('TOKENS lists the seven palette tokens in order', () => {
  assert.deepEqual(Palette.TOKENS, [
    'background',
    'foreground',
    'dim',
    'accent',
    'border',
    'error',
    'success'
  ]);
});

test('claudePreset returns the SPEC §3 hex map', () => {
  assert.deepEqual(Palette.claudePreset(), CLAUDE);
});

test('claudePreset covers exactly the tokens and returns a fresh copy', () => {
  const preset = Palette.claudePreset();
  assert.deepEqual(Object.keys(preset), Palette.TOKENS);
  preset.accent = '#ff0000';
  assert.equal(Palette.claudePreset().accent, '#d97757');
});

test('normalizeColor expands #rgb', () => {
  assert.equal(Palette.normalizeColor('#abc'), '#aabbcc');
  assert.equal(Palette.normalizeColor('#ABC'), '#aabbcc');
  assert.equal(Palette.normalizeColor('  #abc  '), '#aabbcc');
  assert.equal(Palette.normalizeColor('#000'), '#000000');
  assert.equal(Palette.normalizeColor('#fff'), '#ffffff');
});

test('normalizeColor keeps #rrggbb as-is, lowercased', () => {
  assert.equal(Palette.normalizeColor('#D97757'), '#d97757');
  assert.equal(Palette.normalizeColor('#000000'), '#000000');
  assert.equal(Palette.normalizeColor('#f0eee6'), '#f0eee6');
});

test('normalizeColor keeps #aarrggbb as-is (QML order)', () => {
  assert.equal(Palette.normalizeColor('#80ff0000'), '#80ff0000');
});

test('normalizeColor converts a QML color object', () => {
  assert.equal(Palette.normalizeColor({ r: 1, g: 0, b: 0, a: 1 }), '#ff0000');
  assert.equal(Palette.normalizeColor({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(Palette.normalizeColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 }), '#808080');
  // a translucent color keeps its alpha byte in front
  assert.equal(Palette.normalizeColor({ r: 1, g: 1, b: 1, a: 0.5 }), '#80ffffff');
});

test('normalizeColor rejects garbage', () => {
  const bad = [
    '',
    '   ',
    'red',
    'rgba(255,0,0,0.5)',
    'rgb(1,2,3)',
    '#12345',
    '#1234567',
    '#gggggg',
    'blue-ish',
    null,
    undefined,
    42,
    true,
    {}
  ];
  for (const value of bad) {
    assert.equal(Palette.normalizeColor(value), null, 'should reject: ' + JSON.stringify(value));
  }
});

test('fromTheme maps an Omarchy theme object', () => {
  const theme = {
    foreground: '#ffffff',
    background: '#101010',
    accent: '#ff8800',
    muted: '#777777',
    urgent: '#ff0000',
    popups: { border: '#222222' },
    success: '#00ff00'
  };
  const palette = Palette.fromTheme(theme);
  assert.equal(palette.background, '#101010');
  assert.equal(palette.foreground, '#ffffff');
  assert.equal(palette.dim, '#777777');
  assert.equal(palette.accent, '#ff8800');
  assert.equal(palette.border, '#222222');
  assert.equal(palette.error, '#ff0000');
  assert.equal(palette.success, '#00ff00');
});

test('fromTheme reads flat colors.toml-style keys', () => {
  const palette = Palette.fromTheme({ color0: '#000000', color7: '#eeeeee', color4: '#00aaff' });
  assert.equal(palette.background, '#000000');
  assert.equal(palette.foreground, '#eeeeee');
  assert.equal(palette.accent, '#00aaff');
});

test('fromTheme falls back to the claude preset for missing keys', () => {
  const palette = Palette.fromTheme({});
  assert.deepEqual(palette, CLAUDE);
  const partial = Palette.fromTheme({ accent: '#123456' });
  assert.equal(partial.accent, '#123456');
  assert.equal(partial.foreground, '#f0eee6');
  assert.equal(partial.border, '#3a3a37');
});

test('fromTheme falls back to the claude preset for a missing or invalid theme', () => {
  assert.deepEqual(Palette.fromTheme(null), CLAUDE);
  assert.deepEqual(Palette.fromTheme(undefined), CLAUDE);
  assert.deepEqual(Palette.fromTheme('north'), CLAUDE);
  assert.deepEqual(Palette.fromTheme(42), CLAUDE);
});

test('fromTheme ignores an unusable color value', () => {
  const palette = Palette.fromTheme({ accent: 'chartreuse', border: 12 });
  assert.equal(palette.accent, '#d97757');
  assert.equal(palette.border, '#3a3a37');
});

test('fromTheme returns exactly the tokens', () => {
  assert.deepEqual(Object.keys(Palette.fromTheme({})), Palette.TOKENS);
  assert.deepEqual(Object.keys(Palette.fromTheme({ foreground: '#fff' })), Palette.TOKENS);
});

test('resolve with palette "claude" uses the preset', () => {
  assert.deepEqual(Palette.resolve({ palette: 'claude' }), CLAUDE);
  assert.deepEqual(Palette.resolve({ palette: 'claude' }, { foreground: '#ffffff' }), CLAUDE);
});

test('resolve with palette "claude" applies claudePalette over the preset', () => {
  const palette = Palette.resolve({
    palette: 'claude',
    claudePalette: { accent: '#123456', background: '#111111' }
  });
  assert.equal(palette.accent, '#123456');
  assert.equal(palette.background, '#111111');
  // untouched tokens keep the preset value
  assert.equal(palette.foreground, '#f0eee6');
  assert.equal(palette.dim, '#8f8f88');
  assert.equal(palette.border, '#3a3a37');
  assert.equal(palette.error, '#cc6666');
  assert.equal(palette.success, '#6a9bcc');
});

test('resolve with palette "claude" ignores unusable overrides', () => {
  const palette = Palette.resolve({ palette: 'claude', claudePalette: { accent: 'chartreuse' } });
  assert.equal(palette.accent, '#d97757');
});

test('resolve with palette "theme" uses fromTheme', () => {
  const theme = { foreground: '#ffffff', background: '#202020', accent: '#ff8800', muted: '#777777' };
  const palette = Palette.resolve({ palette: 'theme' }, theme);
  assert.equal(palette.foreground, '#ffffff');
  assert.equal(palette.accent, '#ff8800');
  assert.equal(palette.dim, '#777777');
  assert.equal(palette.border, '#3a3a37');
});

test('resolve with palette "theme" keeps the background pure black', () => {
  const theme = { foreground: '#ffffff', background: '#202020' };
  const palette = Palette.resolve({ palette: 'theme' }, theme);
  assert.equal(palette.background, '#000000');
});

test('resolve with an unknown palette name behaves like "theme"', () => {
  const theme = { foreground: '#ffffff', background: '#202020' };
  const palette = Palette.resolve({ palette: 'whatever' }, theme);
  assert.equal(palette.foreground, '#ffffff');
  assert.equal(palette.background, '#000000');
});

test('resolve tolerates a missing ui config and a missing theme', () => {
  assert.deepEqual(Palette.resolve(null, null), CLAUDE);
  assert.deepEqual(Palette.resolve(undefined, undefined), CLAUDE);
  assert.deepEqual(Palette.resolve({}, null), CLAUDE);
});

test('resolve returns exactly the tokens', () => {
  assert.deepEqual(Object.keys(Palette.resolve({ palette: 'claude' })), Palette.TOKENS);
  assert.deepEqual(Object.keys(Palette.resolve({ palette: 'theme' }, {})), Palette.TOKENS);
});
