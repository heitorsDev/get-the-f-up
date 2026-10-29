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
