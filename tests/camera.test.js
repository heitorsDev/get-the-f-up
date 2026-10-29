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

// ---------------------------------------------------------- live preview

test("liveCommand opens the camera once, writes only under the runtime dir and is capped", () => {
  const cmd = Camera.liveCommand("/dev/video2", "/run/user/1000/", 3)
  assert.equal(cmd[0], "bash")
  const script = cmd[2]
  assert.match(script, /exec timeout -k 2 "\$cap" ffmpeg/)
  assert.match(script, /-atomic_writing 1 "\$dir\/preview\.jpg"/)
  assert.match(script, /mkdir -p -m 700/)
  assert.deepEqual(cmd.slice(4), ["/run/user/1000/omarchy-sleep-mode", "/dev/video2", "3", "600"])
})

test("liveCommand falls back to the default device and fps", () => {
  const cmd = Camera.liveCommand("", "/tmp", undefined)
  assert.deepEqual(cmd.slice(4), ["/tmp/omarchy-sleep-mode", "/dev/video0", "3", "600"])
})

test("previewFile and cleanupCommand share one directory", () => {
  assert.equal(Camera.previewFile("/run/user/1000"), "/run/user/1000/omarchy-sleep-mode/preview.jpg")
  assert.deepEqual(Camera.cleanupCommand("/run/user/1000"), ["rm", "-rf", "/run/user/1000/omarchy-sleep-mode"])
})

test("parseLiveLine reads the luma statistics and ignores everything else", () => {
  assert.deepEqual(Camera.parseLiveLine("[Parsed_metadata_3 @ 0x7f] lavfi.signalstats.YAVG=106.233"),
    { key: "YAVG", value: 106.233 })
  assert.deepEqual(Camera.parseLiveLine("lavfi.signalstats.YLOW=17"), { key: "YLOW", value: 17 })
  assert.deepEqual(Camera.parseLiveLine("lavfi.signalstats.YHIGH=136"), { key: "YHIGH", value: 136 })
  assert.equal(Camera.parseLiveLine("lavfi.signalstats.UAVG=126.5"), null)
  assert.equal(Camera.parseLiveLine("Input #0, video4linux2"), null)
})

test("liveErrorCode maps ffmpeg log lines to the same codes as one-shot capture", () => {
  assert.equal(Camera.liveErrorCode("/dev/video0: Permission denied"), "EACCES")
  assert.equal(Camera.liveErrorCode("/dev/video0: Device or resource busy"), "EBUSY")
  assert.equal(Camera.liveErrorCode("/dev/video9: No such file or directory"), "ENOENT")
  assert.equal(Camera.liveErrorCode("frame=3"), "")
})

test("verdict compares a live reading with the saved thresholds", () => {
  const cfg = { lightThreshold: 60, nearBlackCutoff: 24 }
  assert.equal(Camera.verdict(-1, -1, cfg), "unknown")
  assert.equal(Camera.verdict(75, 100, cfg), "on")
  assert.equal(Camera.verdict(60, 100, cfg), "on")
  assert.equal(Camera.verdict(40, 100, cfg), "dim")
  assert.equal(Camera.verdict(17, 0, cfg), "blocked")
  // Dark but with real variance is an open lens in a dark room, not a block.
  assert.equal(Camera.verdict(20, 60, cfg), "dim")
})

// ------------------------------------------------ race-free one-shot capture

function withStubbedFfmpeg(script, run) {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "sleep-mode-cam-"))
  try {
    const file = path.join(dir, "ffmpeg")
    fs.writeFileSync(file, "#!/bin/bash\n" + script)
    fs.chmodSync(file, 0o755)
    return run({ PATH: dir + ":/usr/bin:/bin" })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test("captureShellCommand puts stats and the exit code on one stream", () => {
  withStubbedFfmpeg("echo '[x] lavfi.signalstats.YAVG=75.5' >&2\necho '[x] lavfi.signalstats.YHIGH=136' >&2\nexit 0\n", (env) => {
    const cmd = Camera.captureShellCommand("/dev/video0", 15)
    const res = spawnSync(cmd[0], cmd.slice(1), { env, encoding: "utf8" })
    assert.equal(Camera.parseWrappedExit(res.stdout), 0)
    const reading = Camera.reading(res.stdout, Camera.parseWrappedExit(res.stdout))
    assert.equal(reading.luma, 75.5)
    assert.equal(reading.error, null)
  })
})

test("captureShellCommand reports a failing ffmpeg through the marker", () => {
  withStubbedFfmpeg("echo '/dev/video0: Permission denied' >&2\nexit 1\n", (env) => {
    const cmd = Camera.captureShellCommand("/dev/video0", 15)
    const res = spawnSync(cmd[0], cmd.slice(1), { env, encoding: "utf8" })
    const code = Camera.parseWrappedExit(res.stdout)
    assert.equal(code, 1)
    assert.equal(Camera.reading(res.stdout, code).error, "EACCES")
  })
})

test("parseWrappedExit is null without the marker", () => {
  assert.equal(Camera.parseWrappedExit("no marker here"), null)
  assert.equal(Camera.parseWrappedExit("out\n@@exit=124\n"), 124)
})
