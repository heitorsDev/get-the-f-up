"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")

// QML JS modules start with `.pragma library`, which is not valid JS for node.
function load(name) {
  const file = path.join(__dirname, "..", name)
  const src = fs.readFileSync(file, "utf8").replace(/^\.pragma library\s*$/m, "")
  const mod = { exports: {} }
  vm.runInThisContext("(function (module, exports) {" + src + "\n})", { filename: file })(mod, mod.exports)
  return mod.exports
}

const Lockdown = load("Lockdown.js")

test("urlToPath strips the scheme, decodes and trims the trailing slash", () => {
  assert.equal(Lockdown.urlToPath("file:///home/a/b%20c/"), "/home/a/b c")
  assert.equal(Lockdown.urlToPath("/plain/path"), "/plain/path")
})

test("parseCapture reads every section", () => {
  const text = [
    "@@brightness", "intel_backlight,backlight,12363,51%,24242",
    "@@hyprsunset", "yes",
    "@@gamma", "50",
    "@@stayawake", "no",
    "@@baroff", "no",
    "@@dnd", "off"
  ].join("\n")
  const cap = Lockdown.parseCapture(text)
  assert.equal(cap.hyprsunsetRunning, true)
  assert.equal(cap.stayAwake, false)
  assert.equal(cap.barOff, false)
  assert.equal(cap.dnd, false)
  assert.match(cap.brightnessText, /intel_backlight/)
})

test("parseDnd is null when the shell is unreachable", () => {
  assert.equal(Lockdown.parseDnd(""), null)
  assert.equal(Lockdown.parseDnd("on"), true)
  assert.equal(Lockdown.parseDnd("Off\n"), false)
})

test("plan never touches a stay-awake file or DND the user already had", () => {
  const cfg = { suppressIdle: true, hideBar: true, suppressNotifications: true, pauseMedia: true }
  const fresh = Lockdown.plan(cfg, { stayAwake: false, barOff: false, dnd: false })
  assert.equal(fresh.touchStayAwake, true)
  assert.equal(fresh.hideBar, true)
  assert.equal(fresh.setDnd, true)
  const owned = Lockdown.plan(cfg, { stayAwake: true, barOff: true, dnd: true })
  assert.equal(owned.touchStayAwake, false)
  assert.equal(owned.hideBar, false)
  assert.equal(owned.setDnd, false)
  const unreachable = Lockdown.plan(cfg, { dnd: null })
  assert.equal(unreachable.setDnd, false)
})

test("plan honors every lockdown toggle", () => {
  const off = Lockdown.plan({ suppressIdle: false, hideBar: false, suppressNotifications: false, pauseMedia: false },
    { stayAwake: false, barOff: false, dnd: false })
  assert.equal(off.touchStayAwake, false)
  assert.equal(off.holdInhibitor, false)
  assert.equal(off.hideBar, false)
  assert.equal(off.setDnd, false)
  assert.equal(off.pauseMedia, false)
})

test("pauseTargets picks only playing, pausable players", () => {
  const players = [
    { isPlaying: true, canPause: true },
    { isPlaying: false, canPause: true },
    { isPlaying: true, canPause: false, canTogglePlaying: true },
    { isPlaying: true, canPause: false, canTogglePlaying: false }
  ]
  assert.deepEqual(Lockdown.pauseTargets(players), [0, 2])
})

test("makeRecord flags only the changes the plans intend", () => {
  const rec = Lockdown.makeRecord({
    pid: 42, startedAt: 1000, dryRun: false,
    display: { restoreBrightness: true },
    brightness: { device: "intel_backlight", raw: 12363, percent: 51, max: 24242 },
    hyprsunsetRunning: false, previousGamma: null,
    displayPlan: { dim: true, startHyprsunset: true },
    lockdownPlan: { touchStayAwake: true, hideBar: false, setDnd: true, holdInhibitor: true }
  })
  assert.equal(rec.version, 1)
  assert.equal(rec.pid, 42)
  assert.equal(rec.display.brightnessRaw, 12363)
  assert.equal(rec.display.startedHyprsunset, true)
  assert.equal(rec.display.previousGamma, 100)
  assert.equal(rec.audio, null)
  assert.deepEqual(rec.lockdown, { stayAwakeCreated: true, barOffCreated: false, dndSet: true, inhibitor: true })
})

test("withAudio and withPlayerPid return new records", () => {
  const base = Lockdown.makeRecord({})
  const withAudio = Lockdown.withAudio(base, "sink0", { raw: [100, 100] }, false, { restoreVolume: true })
  assert.equal(base.audio, null)
  assert.deepEqual(withAudio.audio.volumeRaw, [100, 100])
  assert.equal(withAudio.audio.muted, false)
  const withPid = Lockdown.withPlayerPid(withAudio, 777)
  assert.equal(withAudio.audio.playerPid, 0)
  assert.equal(withPid.audio.playerPid, 777)
})

test("maxDurationReached is off at 0 and trips at the cap", () => {
  assert.equal(Lockdown.maxDurationReached({ maxDurationMinutes: 0 }, 0, 10 * 3600000), false)
  assert.equal(Lockdown.maxDurationReached({ maxDurationMinutes: 60 }, 0, 59 * 60000), false)
  assert.equal(Lockdown.maxDurationReached({ maxDurationMinutes: 60 }, 0, 60 * 60000), true)
})

test("emergencyAccepted needs the toggle and the phrase", () => {
  assert.equal(Lockdown.emergencyAccepted({ emergencyExit: false }, "I am awake"), false)
  assert.equal(Lockdown.emergencyAccepted({ emergencyExit: true }, "  I   AM awake "), true)
  assert.equal(Lockdown.emergencyAccepted({ emergencyExit: true }, "nope"), false)
})

// ------------------------------------------------- bin/sleep-mode-restore
// Run the real script against a scratch $HOME with every system command
// replaced by a logging stub, so nothing on the live desktop is touched.

const hasJq = spawnSync("jq", ["--version"]).status === 0
const restoreScript = path.join(__dirname, "..", "bin", "sleep-mode-restore")

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sleep-mode-test-"))
  const home = path.join(root, "home")
  const stubs = path.join(root, "stubs")
  const log = path.join(root, "calls.log")
  fs.mkdirSync(path.join(home, ".local/state/omarchy/sleep-mode"), { recursive: true })
  fs.mkdirSync(path.join(home, ".local/state/omarchy/indicators"), { recursive: true })
  fs.mkdirSync(path.join(home, ".local/state/omarchy/toggles"), { recursive: true })
  fs.mkdirSync(stubs)
  for (const name of ["pactl", "brightnessctl", "hyprctl", "omarchy-shell", "pkill", "kill"]) {
    const file = path.join(stubs, name)
    fs.writeFileSync(file, '#!/bin/bash\necho "' + name + ' $*" >> "' + log + '"\nexit 0\n')
    fs.chmodSync(file, 0o755)
  }
  return {
    home, log,
    active: path.join(home, ".local/state/omarchy/sleep-mode/active.json"),
    stayAwake: path.join(home, ".local/state/omarchy/indicators/stay-awake"),
    barOff: path.join(home, ".local/state/omarchy/toggles/bar-off"),
    run() {
      return spawnSync("bash", [restoreScript], {
        env: { HOME: home, PATH: stubs + ":/usr/bin:/bin" }, encoding: "utf8"
      })
    },
    calls() { return fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [] },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }) }
  }
}

function record(overrides) {
  return Object.assign(Lockdown.makeRecord({
    pid: 1, startedAt: 1, brightness: { device: "intel_backlight", raw: 12363, percent: 51, max: 24242 },
    display: { restoreBrightness: true }, hyprsunsetRunning: false, previousGamma: null,
    displayPlan: { dim: true, startHyprsunset: true },
    lockdownPlan: { touchStayAwake: true, hideBar: true, setDnd: true, holdInhibitor: true }
  }), overrides || {})
}

test("restore undoes display, audio and lockdown, then removes the record", { skip: !hasJq }, () => {
  const box = sandbox()
  try {
    const rec = Lockdown.withAudio(record(), "sink0", { raw: [52428, 52428] }, true, { restoreVolume: true })
    fs.writeFileSync(box.active, JSON.stringify(rec))
    fs.writeFileSync(box.stayAwake, "")
    fs.writeFileSync(box.barOff, "")
    const res = box.run()
    assert.equal(res.status, 0, res.stderr)
    const calls = box.calls().join("\n")
    assert.match(calls, /brightnessctl -d intel_backlight set 12363/)
    assert.match(calls, /hyprctl hyprsunset identity/)
    assert.match(calls, /pkill -x hyprsunset/)
    assert.match(calls, /pactl set-sink-volume sink0 52428 52428/)
    assert.match(calls, /pactl set-sink-mute sink0 1/)
    assert.match(calls, /setDnd off/)
    assert.equal(fs.existsSync(box.stayAwake), false)
    assert.equal(fs.existsSync(box.barOff), false)
    assert.equal(fs.existsSync(box.active), false)
  } finally { box.cleanup() }
})

test("restore is idempotent: a second run acts on nothing", { skip: !hasJq }, () => {
  const box = sandbox()
  try {
    fs.writeFileSync(box.active, JSON.stringify(record()))
    assert.equal(box.run().status, 0)
    const after = box.calls().length
    assert.ok(after > 0)
    assert.equal(box.run().status, 0)
    assert.equal(box.calls().length, after)
  } finally { box.cleanup() }
})

test("restore leaves a stay-awake file the user already had", { skip: !hasJq }, () => {
  const box = sandbox()
  try {
    const rec = record()
    rec.lockdown.stayAwakeCreated = false
    fs.writeFileSync(box.active, JSON.stringify(rec))
    fs.writeFileSync(box.stayAwake, "")
    assert.equal(box.run().status, 0)
    assert.equal(fs.existsSync(box.stayAwake), true)
  } finally { box.cleanup() }
})

test("restore keeps a nightlight hyprsunset the user already ran", { skip: !hasJq }, () => {
  const box = sandbox()
  try {
    const rec = record()
    rec.display.hyprsunsetWasRunning = true
    rec.display.startedHyprsunset = false
    rec.display.previousGamma = 100
    fs.writeFileSync(box.active, JSON.stringify(rec))
    assert.equal(box.run().status, 0)
    const calls = box.calls().join("\n")
    assert.match(calls, /hyprctl hyprsunset gamma 100/)
    assert.doesNotMatch(calls, /hyprsunset identity/)
    assert.doesNotMatch(calls, /pkill -x hyprsunset/)
  } finally { box.cleanup() }
})

test("restore with no record does nothing", () => {
  const box = sandbox()
  try {
    assert.equal(box.run().status, 0)
    assert.deepEqual(box.calls(), [])
  } finally { box.cleanup() }
})
