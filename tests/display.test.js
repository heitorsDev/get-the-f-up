"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
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

const Display = load("Display.js")

test("parseBrightness reads brightnessctl -m output", () => {
  assert.deepEqual(Display.parseBrightness("intel_backlight,backlight,12363,51%,24242\n"),
    { device: "intel_backlight", raw: 12363, percent: 51, max: 24242 })
})

test("parseBrightness rejects garbage", () => {
  assert.equal(Display.parseBrightness(""), null)
  assert.equal(Display.parseBrightness("Device 'x' not found."), null)
  assert.equal(Display.parseBrightness("a,b,c,d,e"), null)
})

test("brightness commands", () => {
  assert.deepEqual(Display.brightnessGetCommand(), ["brightnessctl", "-d", "intel_backlight", "-m"])
  assert.deepEqual(Display.brightnessSetRawCommand("intel_backlight", 12363.4),
    ["brightnessctl", "-q", "-d", "intel_backlight", "set", "12363"])
  assert.deepEqual(Display.brightnessSetPercentCommand("intel_backlight", 0).slice(-1), ["1%"])
  assert.deepEqual(Display.brightnessSetPercentCommand("intel_backlight", 250).slice(-1), ["100%"])
})

test("parseRunning maps pgrep exit codes", () => {
  assert.equal(Display.parseRunning(0), true)
  assert.equal(Display.parseRunning(1), false)
})

test("parseGamma extracts the first number", () => {
  assert.equal(Display.parseGamma("50"), 50)
  assert.equal(Display.parseGamma("gamma: 100%\n"), 100)
  assert.equal(Display.parseGamma("72.6"), 73)
  assert.equal(Display.parseGamma("couldn't connect"), null)
})

test("gammaApplyCommand clamps and passes the value as an argument", () => {
  const cmd = Display.gammaApplyCommand(150)
  assert.equal(cmd[0], "bash")
  assert.equal(cmd[cmd.length - 1], "100")
  assert.match(cmd[2], /seq 1 10/)
  assert.match(cmd[2], /sleep 0\.2/)
  assert.equal(Display.gammaApplyCommand(-3)[4], "0")
  assert.match(Display.gammaApplyCommand(50, 3, 0.5)[2], /seq 1 3[\s\S]*sleep 0\.5/)
})

test("gammaApplyCommand script is valid bash", () => {
  const cmd = Display.gammaApplyCommand(50)
  execFileSync("bash", ["-n", "-c", cmd[2]])
})

test("hyprsunset start/stop/identity", () => {
  assert.match(Display.hyprsunsetStartCommand()[2], /^setsid uwsm-app -- hyprsunset/)
  assert.deepEqual(Display.hyprsunsetStopCommand(), ["pkill", "-x", "hyprsunset"])
  assert.deepEqual(Display.identityCommand(), ["hyprctl", "hyprsunset", "identity"])
})

test("plan starts hyprsunset only when dimming and not running", () => {
  const b = { device: "intel_backlight", raw: 12363, percent: 51, max: 24242 }
  let p = Display.plan({ gammaPercent: 50, laptopBacklightPercent: 100 }, { brightness: b, hyprsunsetRunning: false })
  assert.equal(p.dim, true)
  assert.equal(p.startHyprsunset, true)
  assert.equal(p.setBacklight, false)
  assert.equal(p.gammaPercent, 50)

  p = Display.plan({ gammaPercent: 50 }, { brightness: b, hyprsunsetRunning: true })
  assert.equal(p.startHyprsunset, false)

  p = Display.plan({ gammaPercent: 100 }, { brightness: b, hyprsunsetRunning: false })
  assert.equal(p.dim, false)
  assert.equal(p.startHyprsunset, false)
})

test("plan sets the backlight only for a floor below 100%", () => {
  const b = { device: "intel_backlight", raw: 12363, percent: 51, max: 24242 }
  assert.equal(Display.plan({ laptopBacklightPercent: 20 }, { brightness: b }).setBacklight, true)
  assert.equal(Display.plan({ laptopBacklightPercent: 51 }, { brightness: b }).setBacklight, false)
  assert.equal(Display.plan({ laptopBacklightPercent: 20 }, { brightness: null }).setBacklight, false)
})
