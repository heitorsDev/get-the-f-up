const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A stand-in for `omarchy plugin validate .`, which ships with Omarchy and is
// therefore not available in CI. This asserts the manifest shape documented in
// docs/environment.md ("Manifest contract") and SPEC.md §14.

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// The plugin kinds Omarchy knows about, and the entry point each one needs.
const KIND_ENTRY_POINTS = {
  service: 'Service.qml',
  'bar-widget': 'BarWidget.qml',
  overlay: 'Overlay.qml'
};

test('manifest: schemaVersion is the number 1', () => {
  assert.equal(manifest.schemaVersion, 1);
});

test('manifest: the required fields are present', () => {
  for (const key of ['id', 'name', 'version', 'kinds', 'entryPoints']) {
    assert.ok(manifest[key] !== undefined && manifest[key] !== null, 'missing field: ' + key);
  }
  assert.equal(typeof manifest.id, 'string');
  assert.equal(typeof manifest.name, 'string');
  assert.equal(typeof manifest.version, 'string');
});

test('manifest: the id is valid and does not shadow a first-party plugin', () => {
  assert.match(manifest.id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!manifest.id.includes('..'), 'the id must not contain ".."');
  assert.ok(!manifest.id.startsWith('omarchy.'), 'the id must not start with "omarchy."');
});

test('manifest: kinds is a non-empty list of known kinds', () => {
  assert.ok(Array.isArray(manifest.kinds), 'kinds must be an array');
  assert.ok(manifest.kinds.length > 0, 'kinds must not be empty');
  for (const kind of manifest.kinds) {
    assert.equal(typeof kind, 'string');
    assert.ok(kind in KIND_ENTRY_POINTS, 'unknown plugin kind: ' + kind);
  }
});

test('manifest: the plugin declares no panel kind', () => {
  // A "panel" kind would turn the whole plugin into a panel; the arming dialog
  // and the settings are popouts owned by BarWidget.qml (docs/contracts.md).
  assert.ok(!manifest.kinds.includes('panel'));
});

test('manifest: every entry point exists and stays inside the plugin', () => {
  const entryPoints = manifest.entryPoints;
  assert.equal(typeof entryPoints, 'object');
  assert.ok(entryPoints !== null && !Array.isArray(entryPoints));
  const values = Object.values(entryPoints);
  assert.ok(values.length > 0, 'entryPoints must not be empty');

  for (const rel of values) {
    assert.equal(typeof rel, 'string');
    assert.ok(!rel.includes('..'), 'entry point must not contain "..": ' + rel);
    assert.ok(!path.isAbsolute(rel), 'entry point must be relative: ' + rel);
    const abs = path.resolve(root, rel);
    assert.ok(abs.startsWith(path.resolve(root) + path.sep), 'entry point escapes the plugin: ' + rel);
    assert.ok(fs.existsSync(abs), 'entry point does not exist: ' + rel);
    assert.ok(fs.statSync(abs).isFile(), 'entry point is not a file: ' + rel);
  }
});

test('manifest: every kind has its entry point', () => {
  const values = Object.values(manifest.entryPoints);
  for (const kind of manifest.kinds) {
    assert.ok(values.includes(KIND_ENTRY_POINTS[kind]), 'no entry point for kind: ' + kind);
  }
  assert.equal(values.length, manifest.kinds.length);
});
