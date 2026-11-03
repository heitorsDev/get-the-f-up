"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync, spawnSync } = require("node:child_process")
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

const Audio = load("Audio.js")
const ALSA = "alsa_output.pci-0000_00_1f.3.analog-stereo"
const BT = "bluez_output.88_92_CC_B9_18_5C.1"

const SINKS = "55\t" + ALSA + "\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED\n" +
  "78\t" + BT + "\tPipeWire\ts16le 2ch 48000Hz\tRUNNING\n"

test("parseSinkList reads pactl list short sinks", () => {
  assert.deepEqual(Audio.parseSinkList(SINKS), [ALSA, BT])
  assert.deepEqual(Audio.parseSinkList(""), [])
})

test("parseDefaultSink", () => {
  assert.equal(Audio.parseDefaultSink(BT + "\n"), BT)
  assert.equal(Audio.parseDefaultSink("Connection failure: Connection refused"), "")
})

test("resolveSink prefers the configured sink", () => {
  assert.deepEqual(Audio.resolveSink(ALSA, [ALSA, BT], BT), { sink: ALSA, fallback: false, reason: "" })
})

test("resolveSink falls back to the default when the configured sink is missing", () => {
  const r = Audio.resolveSink(ALSA, [BT], BT)
  assert.equal(r.sink, BT)
  assert.equal(r.fallback, true)
  assert.match(r.reason, /unavailable/)
})

test("resolveSink with null config uses the default", () => {
  assert.deepEqual(Audio.resolveSink(null, [ALSA, BT], BT), { sink: BT, fallback: false, reason: "" })
})

test("resolveSink with nothing usable", () => {
  assert.equal(Audio.resolveSink(ALSA, [BT], "").sink, BT)
  assert.equal(Audio.resolveSink(ALSA, [], "").sink, "")
})

test("parseVolume reads per-channel raw and percent", () => {
  const text = "Volume: front-left: 52428 /  80% / -5.81 dB,   front-right: 52428 /  80% / -5.81 dB\n        balance 0.00\n"
  assert.deepEqual(Audio.parseVolume(text), { raw: [52428, 52428], percent: [80, 80] })
  assert.deepEqual(Audio.parseVolume("Volume: mono: 65536 / 100% / 0.00 dB"), { raw: [65536], percent: [100] })
  assert.equal(Audio.parseVolume("No such entity"), null)
})

test("parseMute", () => {
  assert.equal(Audio.parseMute("Mute: no\n"), false)
  assert.equal(Audio.parseMute("Mute: yes\n"), true)
  assert.equal(Audio.parseMute(""), null)
})

test("volume and mute commands", () => {
  assert.deepEqual(Audio.setVolumeCommand(ALSA, 80), ["pactl", "set-sink-volume", ALSA, "80%"])
  assert.deepEqual(Audio.setVolumeCommand(ALSA, 400)[3], "150%")
  assert.deepEqual(Audio.setVolumeRawCommand(ALSA, [52428, 50000]), ["pactl", "set-sink-volume", ALSA, "52428", "50000"])
  assert.deepEqual(Audio.setMuteCommand(ALSA, true), ["pactl", "set-sink-mute", ALSA, "1"])
  assert.deepEqual(Audio.setMuteCommand(ALSA, false), ["pactl", "set-sink-mute", ALSA, "0"])
})

test("forceCommand honors unmute and volume", () => {
  let c = Audio.forceCommand(ALSA, { volumePercent: 70, unmute: true })
  assert.match(c[2], /set-sink-mute "\$1" 0/)
  assert.deepEqual(c.slice(3), ["get-the-f-up-audio", ALSA, "70%"])
  c = Audio.forceCommand(ALSA, { volumePercent: 70, unmute: false })
  assert.doesNotMatch(c[2], /set-sink-mute/)
  assert.equal(Audio.forceCommand(ALSA, {})[5], "80%")
})

test("soundCandidates order: user, bundled, freedesktop", () => {
  assert.deepEqual(Audio.soundCandidates({ soundPath: "/x/y.ogg" }, "/plug/"),
    ["/x/y.ogg", "/plug/assets/alarm.oga", Audio.FREEDESKTOP_ALARM])
  assert.deepEqual(Audio.soundCandidates({ soundPath: null }, "/plug"),
    ["/plug/assets/alarm.oga", Audio.FREEDESKTOP_ALARM])
})

test("pickSoundCommand prints the first readable file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "get-the-f-up-audio-"))
  const real = path.join(dir, "a.oga")
  fs.writeFileSync(real, "x")
  const cmd = Audio.pickSoundCommand([path.join(dir, "missing.ogg"), real])
  const out = execFileSync(cmd[0], cmd.slice(1)).toString()
  assert.equal(Audio.parsePickedSound(out), real)
  const none = Audio.pickSoundCommand([path.join(dir, "missing.ogg")])
  assert.equal(spawnSync(none[0], none.slice(1)).status, 1)
  fs.rmSync(dir, { recursive: true })
})

test("playerCommand uses the pipewire device syntax and carries the marker", () => {
  const c = Audio.playerCommand(ALSA, "/plug/assets/alarm.oga")
  assert.equal(c[0], "bash")
  assert.equal(c[3], Audio.PLAYER_MARKER)
  assert.deepEqual(c.slice(4), [ALSA, "/plug/assets/alarm.oga", "pipewire/" + ALSA])
  assert.match(c[2], /exec mpv --loop=inf --no-video --really-quiet/)
  assert.match(c[2], /--title="\$0"/)
  execFileSync("bash", ["-n", "-c", c[2]])
  assert.equal(Audio.playerCommand("", "/f")[6], "auto")
})

test("helper scripts are valid bash", () => {
  for (const c of [Audio.sinkProbeCommand(), Audio.captureCommand(ALSA), Audio.forceCommand(ALSA, {})]) {
    execFileSync("bash", ["-n", "-c", c[2]])
  }
})
