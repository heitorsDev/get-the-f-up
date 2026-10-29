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

// ------------------------------------------------ framing (collector reuse)

test("unwrap drops anything before the last @@begin line", () => {
  // The collector's text is not reliably reset between runs: an older
  // command's output can still be in front of the current one.
  const raw = "old output\n@@exit=1\n@@begin\n@@sinks\n55\talsa\n@@exit=0\n"
  const framed = Camera.unwrap(raw)
  assert.equal(framed.output, "@@sinks\n55\talsa\n")
  assert.equal(framed.exit, 0)
})

test("unwrap keeps section headers intact when the collector was reset", () => {
  const framed = Camera.unwrap("@@begin\n@@brightness\nintel_backlight,backlight,12363,51%,24242\n@@exit=0\n")
  assert.match(framed.output, /^@@brightness\n/)
  assert.equal(framed.exit, 0)
})

test("unwrap tolerates a missing marker and missing begin", () => {
  assert.deepEqual(Camera.unwrap("just text"), { output: "just text", exit: null })
  assert.equal(Camera.unwrap("").exit, null)
})

test("wrapCommand runs any argv with the output framed", () => {
  const cmd = Camera.wrapCommand(["bash", "-c", "echo hi; exit 3", "x"], "sleep-mode-step")
  const res = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" })
  const framed = Camera.unwrap(res.stdout)
  assert.equal(framed.output, "hi\n")
  assert.equal(framed.exit, 3)
})

// ------------------------------------------------- watching the light live

test("liveCommand takes a longer cap for the challenge", () => {
  assert.equal(Camera.liveCommand("", "/tmp", 3, 3600)[7], "3600")
  assert.equal(Camera.liveCommand("", "/tmp", 3)[7], "600")
})

test("watchProgress runs from black (16) to the threshold", () => {
  assert.equal(Camera.watchProgress(16, 60), 0)
  assert.equal(Camera.watchProgress(38, 60), 0.5)
  assert.equal(Camera.watchProgress(60, 60), 1)
  assert.equal(Camera.watchProgress(200, 60), 1)
  assert.equal(Camera.watchProgress(-1, 60), 0)
  // A threshold at or below black cannot divide by zero.
  assert.equal(Camera.watchProgress(20, 16), 1)
})

function feed(samples, cfg) {
  let state = Camera.watchInit()
  const out = []
  for (const s of samples) {
    const r = Camera.watchStep(state, s, cfg)
    state = r.state
    out.push(r)
  }
  return out
}

const WATCH_CFG = { lightThreshold: 60, nearBlackCutoff: 24 }

test("watchStep passes only after the light has been held for a few samples", () => {
  const bright = { luma: 90, spread: 80 }
  const r = feed([bright, bright, bright], WATCH_CFG)
  assert.deepEqual(r.map((x) => x.outcome), ["waiting", "waiting", "pass"])
  assert.equal(r[2].verdict, "on")
  assert.equal(r[0].progress, 1)
  assert.equal(Math.round(r[1].hold * 100), 67)
})

test("watchStep: a single bright frame does not pass and the hold resets", () => {
  const bright = { luma: 90, spread: 80 }
  const dim = { luma: 40, spread: 60 }
  const r = feed([bright, bright, dim, bright, bright], WATCH_CFG)
  assert.ok(r.every((x) => x.outcome === "waiting"))
  assert.equal(r[2].hold, 0)
  assert.equal(r[2].verdict, "dim")
})

test("watchStep reports blocked only after a sustained black, flat stream", () => {
  const black = { luma: 17, spread: 0 }
  const r = feed(new Array(15).fill(black), WATCH_CFG)
  assert.equal(r[13].outcome, "waiting")
  assert.equal(r[14].outcome, "blocked")
  assert.equal(r[14].verdict, "blocked")
})

test("watchStep: warm-up darkness followed by light never reports blocked", () => {
  const black = { luma: 17, spread: 0 }
  const bright = { luma: 90, spread: 80 }
  const r = feed([...new Array(10).fill(black), bright, bright, bright], WATCH_CFG)
  assert.equal(r[r.length - 1].outcome, "pass")
  assert.ok(!r.some((x) => x.outcome === "blocked"))
})

test("watchStep treats a missing sample as nothing yet", () => {
  const r = Camera.watchStep(Camera.watchInit(), { luma: -1, spread: -1 }, WATCH_CFG)
  assert.equal(r.outcome, "waiting")
  assert.equal(r.verdict, "unknown")
  assert.equal(r.progress, 0)
})

test("watchStep follows the threshold it is given", () => {
  const sample = { luma: 90, spread: 80 }
  assert.equal(feed([sample, sample, sample], { lightThreshold: 120, nearBlackCutoff: 24 })[2].outcome, "waiting")
  assert.equal(feed([sample, sample, sample], { lightThreshold: 80, nearBlackCutoff: 24 })[2].outcome, "pass")
})
