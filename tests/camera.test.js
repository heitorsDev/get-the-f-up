"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
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

const Camera = load("Camera.js")
const CFG = { lightThreshold: 60, nearBlackCutoff: 24 }

function frame(stats) {
  return Object.keys(stats).map(k => "[Parsed_metadata_2 @ 0x55] lavfi.signalstats." + k + "=" + stats[k]).join("\n") + "\n"
}

test("captureCommand reads one settled frame from v4l2 into the null muxer", () => {
  const c = Camera.captureCommand("/dev/video0")
  assert.equal(c[0], "timeout")
  assert.ok(c.includes("ffmpeg"))
  assert.deepEqual(c.slice(c.indexOf("-i"), c.indexOf("-i") + 2), ["-i", "/dev/video0"])
  assert.equal(c[c.indexOf("-vf") + 1], "select=gte(n\\,15),signalstats,metadata=print")
  assert.deepEqual(c.slice(-3), ["-f", "null", "-"])
  assert.ok(!c.includes("-loglevel"))
  assert.equal(Camera.captureCommand(null, 0)[Camera.captureCommand(null, 0).indexOf("-i") + 1], "/dev/video0")
})

test("parseSignalstats and parseYavg", () => {
  const text = "garbage\n" + frame({ YMIN: 16, YLOW: 40, YAVG: 126.5, YHIGH: 200, YMAX: 235 })
  assert.deepEqual(Camera.parseSignalstats(text), { YMIN: 16, YLOW: 40, YAVG: 126.5, YHIGH: 200, YMAX: 235 })
  assert.equal(Camera.parseYavg(text), 126.5)
  assert.equal(Camera.parseYavg("nothing"), null)
})

test("reading reports luma and spread", () => {
  const r = Camera.reading(frame({ YLOW: 40, YAVG: 120, YHIGH: 200 }), 0)
  assert.equal(r.luma, 120)
  assert.equal(r.variance, 160)
  assert.equal(r.error, null)
})

test("reading maps device failures to error codes", () => {
  assert.equal(Camera.reading("[video4linux2] Cannot open video device /dev/video0: Permission denied", 1).error, "EACCES")
  assert.equal(Camera.reading("ioctl(VIDIOC_STREAMON): Device or resource busy", 1).error, "EBUSY")
  assert.equal(Camera.reading("/dev/video9: No such file or directory", 1).error, "ENOENT")
  assert.equal(Camera.reading("", 124).error, "ETIMEDOUT")
  assert.equal(Camera.reading("", 127).error, "ENOFFMPEG")
  assert.equal(Camera.reading("Stream mapping: ...", 0).error, "ENODATA")
  const r = Camera.reading("Permission denied", 1)
  assert.equal(r.luma, null)
  assert.equal(r.variance, null)
  assert.ok(Camera.errorMessage("EBUSY").length > 0)
})

test("classify: open lens, blocked lens, unavailable", () => {
  assert.equal(Camera.classify(Camera.reading(frame({ YLOW: 60, YAVG: 110, YHIGH: 170 }), 0), CFG), "ok")
  // A dark room with an open lens still has sensor noise / structure.
  assert.equal(Camera.classify(Camera.reading(frame({ YLOW: 16, YAVG: 20, YHIGH: 30 }), 0), CFG), "ok")
  assert.equal(Camera.classify(Camera.reading(frame({ YLOW: 16, YAVG: 16.4, YHIGH: 17 }), 0), CFG), "blocked")
  assert.equal(Camera.classify(Camera.reading("Device or resource busy", 1), CFG), "unavailable")
  assert.equal(Camera.classify(null, CFG), "unavailable")
})

test("isNearBlack needs both low luma and a flat frame", () => {
  assert.equal(Camera.isNearBlack({ luma: 16, variance: 0 }, CFG), true)
  assert.equal(Camera.isNearBlack({ luma: 16, variance: 30 }, CFG), false)
  assert.equal(Camera.isNearBlack({ luma: 40, variance: 0 }, CFG), false)
  assert.equal(Camera.isNearBlack({ luma: null, variance: 0 }, CFG), false)
})

test("the filter chain works in real ffmpeg on synthetic frames", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 }, () => {
  const c = Camera.captureCommand("/dev/video0", 2)
  const vf = c[c.indexOf("-vf") + 1]
  for (const [color, lo, hi] of [["black", 15, 17], ["white", 234, 236]]) {
    const res = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "color=" + color + ":s=64x48:r=30",
      "-frames:v", "1", "-vf", vf, "-an", "-f", "null", "-"])
    const r = Camera.reading(res.stderr.toString(), res.status)
    assert.equal(r.error, null)
    assert.ok(r.luma >= lo && r.luma <= hi, color + " luma " + r.luma)
    assert.equal(r.variance, 0)
  }
})
