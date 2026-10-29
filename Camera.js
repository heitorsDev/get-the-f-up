.pragma library

// Camera light check: one frame from V4L2 through ffmpeg's signalstats,
// reduced to numbers. No image is ever written anywhere: ffmpeg's output
// muxer is `null`, and only the metadata lines on stderr are read.

var DEFAULT_DEVICE = "/dev/video0"
// UVC cameras underexpose the first frames while auto-exposure settles, so
// the measured frame is the Nth one (~0.5 s in at 30 fps).
var SETTLE_FRAMES = 15
var TIMEOUT_S = 10
// YHIGH - YLOW (90th minus 10th percentile of luma) at or below this is
// "no measurable variance": a closed shutter reads a flat 16-17.
var FLAT_SPREAD = 2

// The live preview is the one exception to "nothing is written": while the
// settings panel's preview button is on, frames go to a file in the user's
// runtime dir (tmpfs, mode 0700) so the panel can show them. The file is
// removed when the preview stops, and the stream is capped.
var LIVE_FPS = 3
var LIVE_CAP_S = 600

function previewDir(runtimeDir) {
  return String(runtimeDir || "/tmp").replace(/\/+$/, "") + "/omarchy-sleep-mode"
}

function previewFile(runtimeDir) {
  return previewDir(runtimeDir) + "/preview.jpg"
}

// One process, one open of the camera: a scaled JPEG overwritten at LIVE_FPS,
// plus signalstats lines on stderr (ffmpeg's log). `timeout` is the safety
// net if the shell dies without stopping the stream.
function liveCommand(device, runtimeDir, fps, capSeconds) {
  var script = [
    "dir=\"$1\"; dev=\"$2\"; fps=\"$3\"; cap=\"$4\"",
    "mkdir -p -m 700 \"$dir\" || exit 1",
    "exec timeout -k 2 \"$cap\" ffmpeg -hide_banner -nostdin -nostats -loglevel info " +
      "-f v4l2 -input_format mjpeg -video_size 640x480 -framerate 15 -i \"$dev\" " +
      "-vf \"fps=$fps,scale=320:-1,signalstats,metadata=print\" " +
      "-q:v 6 -f image2 -update 1 -atomic_writing 1 \"$dir/preview.jpg\""
  ].join("\n")
  return ["bash", "-c", script, "sleep-mode-camera-live", previewDir(runtimeDir),
    String(device || DEFAULT_DEVICE), String(fps || LIVE_FPS), String(capSeconds || LIVE_CAP_S)]
}

function cleanupCommand(runtimeDir) {
  return ["rm", "-rf", previewDir(runtimeDir)]
}

// One ffmpeg log line -> { key: "YAVG", value: 75.8 } or null.
function parseLiveLine(line) {
  var m = /lavfi\.signalstats\.(YAVG|YLOW|YHIGH)=(-?[0-9.]+)/.exec(String(line || ""))
  if (!m) return null
  var v = parseFloat(m[2])
  return isNaN(v) ? null : { key: m[1], value: v }
}

// An error code for one log line, or "" when the line is not an error.
function liveErrorCode(line) {
  var s = String(line || "")
  if (/Permission denied/i.test(s)) return "EACCES"
  if (/Device or resource busy/i.test(s)) return "EBUSY"
  if (/No such file or directory/i.test(s)) return "ENOENT"
  if (/Inappropriate ioctl|Not a video capture device|Invalid argument/i.test(s)) return "ENODEV"
  return ""
}

// What a live reading means against the saved thresholds, for the readout:
// "on" (the light check would pass), "dim" (too dark to pass) or "blocked"
// (near-black and flat: the step would be skipped).
function verdict(luma, spread, cameraConfig) {
  if (luma === null || luma === undefined || Number(luma) < 0) return "unknown"
  var cfg = cameraConfig || {}
  var threshold = cfg.lightThreshold === undefined ? 60 : Number(cfg.lightThreshold)
  if (isNearBlack({ luma: Number(luma), variance: Number(spread) < 0 ? null : Number(spread) }, cfg)) return "blocked"
  return Number(luma) >= threshold ? "on" : "dim"
}

// ---------------------------------------------------- watching the light
// The challenge's camera step does not ask for a capture: it watches the
// live stream and passes by itself once the light has been bright enough for
// a moment.
//
// A single bright frame (a flash, a screen) must not pass the step, and the
// first frames of a cold camera are underexposed, so a blocked lens is only
// believed after it has stayed black and flat for a few seconds.
var WATCH_PASS_SAMPLES = 3
var WATCH_BLOCKED_SAMPLES = 15

function watchInit() {
  return { held: 0, blocked: 0 }
}

// How far the light is toward the threshold, 0..1: black (16) is empty and
// the threshold is full.
function watchProgress(luma, threshold) {
  var t = Number(threshold)
  var l = Number(luma)
  if (isNaN(l) || l < 0) return 0
  if (!(t > 16)) return l >= t ? 1 : 0
  return Math.max(0, Math.min(1, (l - 16) / (t - 16)))
}

// sample: { luma, spread } -> { state, verdict, progress, hold, outcome }
// outcome: "pass" | "blocked" | "waiting"
function watchStep(state, sample, cameraConfig) {
  var cfg = cameraConfig || {}
  var prev = state || watchInit()
  var threshold = cfg.lightThreshold === undefined ? 60 : Number(cfg.lightThreshold)
  var luma = sample ? Number(sample.luma) : -1
  var spread = sample && sample.spread !== undefined ? Number(sample.spread) : -1
  var v = verdict(luma, spread, cfg)
  var held = v !== "unknown" && luma >= threshold ? prev.held + 1 : 0
  var blocked = v === "blocked" ? prev.blocked + 1 : 0
  var outcome = "waiting"
  if (held >= WATCH_PASS_SAMPLES) outcome = "pass"
  else if (blocked >= WATCH_BLOCKED_SAMPLES) outcome = "blocked"
  return {
    state: { held: held, blocked: blocked },
    verdict: v,
    progress: watchProgress(luma, threshold),
    hold: Math.min(1, held / WATCH_PASS_SAMPLES),
    outcome: outcome
  }
}

// ---------------------------------------------------------- the light gate
// The optional "require the light" mode runs alongside the challenges rather
// than as a step: while it is on, the challenges are locked unless the room
// light is on, and they lock again if it goes off.
//
// Unlocking takes the same few steady samples as a camera step. Locking again
// waits a couple of seconds below the threshold, so a passing shadow or an
// auto-exposure wobble does not slam the challenge shut. A lens that stays
// black and flat is not a light that is off: the gate lets go of it ("blocked",
// like the camera step's blocked-lens skip), so an unusable camera never
// strands anyone.
var GATE_ON_SAMPLES = 3
var GATE_OFF_SAMPLES = 6

function gateInit() {
  return { unlocked: false, bright: 0, dark: 0, blocked: 0, released: "" }
}

// sample: { luma, spread } ->
//   { state, unlocked, released, verdict, progress, hold }
// released: "" | "blocked" (the gate no longer applies this session)
function gateStep(state, sample, cameraConfig) {
  var cfg = cameraConfig || {}
  var prev = state || gateInit()
  var threshold = cfg.lightThreshold === undefined ? 60 : Number(cfg.lightThreshold)
  var luma = sample ? Number(sample.luma) : -1
  var spread = sample && sample.spread !== undefined ? Number(sample.spread) : -1
  var v = verdict(luma, spread, cfg)

  var next = { unlocked: prev.unlocked, bright: prev.bright, dark: prev.dark,
    blocked: prev.blocked, released: prev.released }
  if (v === "unknown" || next.released !== "") {
    // No reading yet, or already let go: nothing to count.
  } else {
    var isBright = luma >= threshold
    next.bright = isBright ? prev.bright + 1 : 0
    next.dark = isBright ? 0 : prev.dark + 1
    next.blocked = v === "blocked" ? prev.blocked + 1 : 0
    if (next.blocked >= WATCH_BLOCKED_SAMPLES) next.released = "blocked"
    else if (!next.unlocked && next.bright >= GATE_ON_SAMPLES) next.unlocked = true
    else if (next.unlocked && next.dark >= GATE_OFF_SAMPLES) next.unlocked = false
  }

  return {
    state: next,
    unlocked: next.released !== "" || next.unlocked,
    released: next.released,
    verdict: v,
    progress: watchProgress(luma, threshold),
    // While locked, how far into the steady light the unlock is; while
    // unlocked, how far into the dark the re-lock is (full = still fine).
    hold: next.unlocked ? 1 - Math.min(1, next.dark / GATE_OFF_SAMPLES)
      : Math.min(1, next.bright / GATE_ON_SAMPLES)
  }
}

// One-shot capture whose output and exit code arrive on the same stream.
// Reading the exit code from the Process `exited` signal races the output
// collectors and can leave the text empty (parsed as ENODATA).
//
// A `@@begin` line is printed first so a reader can drop anything that came
// before it: the output collector's text is not reliably reset between runs.
var BEGIN_MARKER = "@@begin"
var WRAP_SCRIPT = "echo " + BEGIN_MARKER + "; \"$@\" 2>&1; rc=$?; echo \"@@exit=$rc\""

// Any argv, run so that its output and exit code arrive on one stream.
function wrapCommand(argv, name) {
  return ["bash", "-c", WRAP_SCRIPT, name || "sleep-mode-step"].concat(argv)
}

function captureShellCommand(device, settleFrames) {
  return wrapCommand(captureCommand(device, settleFrames), "sleep-mode-camera")
}

// The text after the last @@begin line, with the @@exit marker removed:
// { output, exit } (exit is null when the marker is missing).
function unwrap(raw) {
  var s = String(raw || "")
  var at = s.lastIndexOf(BEGIN_MARKER + "\n")
  if (at >= 0) s = s.substring(at + BEGIN_MARKER.length + 1)
  var m = /@@exit=(\d+)\s*$/.exec(s)
  return { output: m ? s.substring(0, m.index) : s, exit: m ? parseInt(m[1], 10) : null }
}

// "...output\n@@exit=0" -> 0; null when the marker is missing.
function parseWrappedExit(text) {
  return unwrap(text).exit
}

function captureCommand(device, settleFrames) {
  var n = settleFrames === undefined ? SETTLE_FRAMES : Math.max(0, Math.round(Number(settleFrames) || 0))
  return ["timeout", "-k", "2", String(TIMEOUT_S),
    "ffmpeg", "-hide_banner", "-nostdin",
    "-f", "v4l2", "-input_format", "mjpeg", "-video_size", "640x480",
    "-i", String(device || DEFAULT_DEVICE),
    "-frames:v", "1",
    // metadata=print logs at INFO; do not lower -loglevel or the lines vanish.
    "-vf", "select=gte(n\\," + n + "),signalstats,metadata=print",
    "-an", "-f", "null", "-"]
}

// All lavfi.signalstats.* values of the last printed frame.
function parseSignalstats(text) {
  var out = {}
  var re = /lavfi\.signalstats\.([A-Z]+)=(-?[0-9.]+)/g
  var m
  var s = String(text || "")
  while ((m = re.exec(s)) !== null) {
    var v = parseFloat(m[2])
    if (!isNaN(v)) out[m[1]] = v
  }
  return out
}

function parseYavg(text) {
  var stats = parseSignalstats(text)
  return stats.YAVG === undefined ? null : stats.YAVG
}

// Map ffmpeg/timeout failure output to a short error code, or "" when none.
function parseError(text, exitCode) {
  var s = String(text || "")
  var code = Number(exitCode)
  if (/Permission denied/i.test(s)) return "EACCES"
  if (/Device or resource busy/i.test(s)) return "EBUSY"
  if (/No such file or directory/i.test(s)) return "ENOENT"
  if (/Inappropriate ioctl|Not a video capture device|Invalid argument/i.test(s)) return "ENODEV"
  if (code === 124 || code === 137) return "ETIMEDOUT"
  if (code === 127) return "ENOFFMPEG"
  if (parseYavg(s) === null) return code === 0 ? "ENODATA" : "EIO"
  return ""
}

function errorMessage(code) {
  switch (code) {
  case "EACCES": return "no permission to open the camera"
  case "EBUSY": return "camera is in use by another application"
  case "ENOENT": return "camera device not found"
  case "ENODEV": return "device is not a usable camera"
  case "ETIMEDOUT": return "camera did not deliver a frame in time"
  case "ENOFFMPEG": return "ffmpeg is not installed"
  case "ENODATA": return "camera returned no frame"
  case "EIO": return "camera capture failed"
  default: return code ? String(code) : ""
  }
}

// -> { luma, variance, error, stats }
// `variance` is the luma spread YHIGH - YLOW (signalstats has no stddev).
function reading(text, exitCode) {
  var stats = parseSignalstats(text)
  var luma = stats.YAVG === undefined ? null : stats.YAVG
  var err = parseError(text, exitCode)
  if (luma !== null && Number(exitCode) === 0) err = ""
  if (err) return { luma: null, variance: null, error: err, stats: stats }
  var variance = stats.YHIGH !== undefined && stats.YLOW !== undefined
    ? Math.max(0, stats.YHIGH - stats.YLOW) : null
  return { luma: luma, variance: variance, error: null, stats: stats }
}

function isNearBlack(r, cameraConfig) {
  if (!r || r.luma === null || r.luma === undefined) return false
  var cutoff = cameraConfig && cameraConfig.nearBlackCutoff !== undefined
    ? Number(cameraConfig.nearBlackCutoff) : 24
  var flat = r.variance === null || r.variance === undefined || Number(r.variance) <= FLAT_SPREAD
  return Number(r.luma) < cutoff && flat
}

// Arm-time pre-check verdict: "ok" | "blocked" | "unavailable".
// A dark room with an open lens is "ok": the camera works, the light is off.
function classify(r, cameraConfig) {
  if (!r || r.error || r.luma === null || r.luma === undefined) return "unavailable"
  return isNearBlack(r, cameraConfig) ? "blocked" : "ok"
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_DEVICE: DEFAULT_DEVICE,
    SETTLE_FRAMES: SETTLE_FRAMES,
    TIMEOUT_S: TIMEOUT_S,
    FLAT_SPREAD: FLAT_SPREAD,
    LIVE_FPS: LIVE_FPS,
    LIVE_CAP_S: LIVE_CAP_S,
    previewDir: previewDir,
    previewFile: previewFile,
    liveCommand: liveCommand,
    cleanupCommand: cleanupCommand,
    parseLiveLine: parseLiveLine,
    liveErrorCode: liveErrorCode,
    verdict: verdict,
    GATE_ON_SAMPLES: GATE_ON_SAMPLES,
    GATE_OFF_SAMPLES: GATE_OFF_SAMPLES,
    gateInit: gateInit,
    gateStep: gateStep,
    WATCH_PASS_SAMPLES: WATCH_PASS_SAMPLES,
    WATCH_BLOCKED_SAMPLES: WATCH_BLOCKED_SAMPLES,
    watchInit: watchInit,
    watchProgress: watchProgress,
    watchStep: watchStep,
    BEGIN_MARKER: BEGIN_MARKER,
    wrapCommand: wrapCommand,
    unwrap: unwrap,
    captureShellCommand: captureShellCommand,
    parseWrappedExit: parseWrappedExit,
    captureCommand: captureCommand,
    parseSignalstats: parseSignalstats,
    parseYavg: parseYavg,
    parseError: parseError,
    errorMessage: errorMessage,
    reading: reading,
    isNearBlack: isNearBlack,
    classify: classify
  }
}
