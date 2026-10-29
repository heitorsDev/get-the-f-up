.pragma library

// Display control: laptop backlight capture/restore and hyprsunset gamma.
// Pure command builders and output parsers; Service.qml runs them via Process.

var BACKLIGHT_DEVICE = "intel_backlight"
var GAMMA_TRIES = 10
var GAMMA_INTERVAL_S = 0.2

function brightnessGetCommand(device) {
  return ["brightnessctl", "-d", String(device || BACKLIGHT_DEVICE), "-m"]
}

// "intel_backlight,backlight,12363,51%,24242" -> { device, raw, percent, max }
function parseBrightness(text) {
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].trim().split(",")
    if (parts.length < 5) continue
    var raw = parseInt(parts[2], 10)
    var percent = parseInt(String(parts[3]).replace("%", ""), 10)
    var max = parseInt(parts[4], 10)
    if (isNaN(raw) || isNaN(max)) continue
    return {
      device: parts[0],
      raw: raw,
      percent: isNaN(percent) ? (max > 0 ? Math.round(raw * 100 / max) : 0) : percent,
      max: max
    }
  }
  return null
}

function brightnessSetRawCommand(device, raw) {
  return ["brightnessctl", "-q", "-d", String(device || BACKLIGHT_DEVICE), "set",
    String(Math.max(0, Math.round(Number(raw) || 0)))]
}

function brightnessSetPercentCommand(device, percent) {
  return ["brightnessctl", "-q", "-d", String(device || BACKLIGHT_DEVICE), "set",
    clampPercent(percent, 1, 100) + "%"]
}

function clampPercent(value, lo, hi) {
  var n = Math.round(Number(value))
  if (isNaN(n)) n = hi
  return Math.max(lo, Math.min(hi, n))
}

function hyprsunsetRunningCommand() {
  return ["pgrep", "-x", "hyprsunset"]
}

// pgrep exits 0 when a match exists, 1 when none.
function parseRunning(exitCode) {
  return Number(exitCode) === 0
}

// Started the way Omarchy's nightlight toggle does it, fully detached so it
// survives the shell (the restore path stops it if we started it).
function hyprsunsetStartCommand() {
  return ["bash", "-c", "setsid uwsm-app -- hyprsunset >/dev/null 2>&1 &"]
}

function hyprsunsetStopCommand() {
  return ["pkill", "-x", "hyprsunset"]
}

function gammaQueryCommand() {
  return ["hyprctl", "hyprsunset", "gamma"]
}

// First integer in `hyprctl hyprsunset gamma` output, or null.
function parseGamma(text) {
  var m = String(text || "").match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  var n = Math.round(parseFloat(m[0]))
  return isNaN(n) ? null : n
}

function clampGamma(percent) {
  return clampPercent(percent, 0, 100)
}

// A freshly started hyprsunset applies its profile at the end of boot and can
// clobber a value set before then, so resend until the query reads it back
// (the omarchy-toggle-nightlight workaround). If the query never returns a
// number, every try is still sent, which is harmless.
function gammaApplyCommand(percent, tries, interval) {
  var p = clampGamma(percent)
  var n = Math.max(1, Math.round(Number(tries) || GAMMA_TRIES))
  var s = Number(interval) > 0 ? Number(interval) : GAMMA_INTERVAL_S
  var script = [
    "target=\"$1\"",
    "for _ in $(seq 1 " + n + "); do",
    "  hyprctl hyprsunset gamma \"$target\" >/dev/null 2>&1",
    "  sleep " + s,
    "  current=$(hyprctl hyprsunset gamma 2>/dev/null | grep -oE '[0-9]+' | head -n1)",
    "  [ \"$current\" = \"$target\" ] && exit 0",
    "done",
    "exit 0"
  ].join("\n")
  return ["bash", "-c", script, "sleep-mode-gamma", String(p)]
}

function identityCommand() {
  return ["hyprctl", "hyprsunset", "identity"]
}

// What arming should do to the display given the config and the captured state.
// captured: { brightness: parseBrightness()|null, hyprsunsetRunning: bool }
function plan(displayConfig, captured) {
  var cfg = displayConfig || {}
  var cap = captured || {}
  var gamma = clampGamma(cfg.gammaPercent === undefined ? 50 : cfg.gammaPercent)
  var dim = String(cfg.dimMethod || "gamma") === "gamma" && gamma < 100
  var backlight = clampPercent(cfg.laptopBacklightPercent === undefined ? 100 : cfg.laptopBacklightPercent, 1, 100)
  var hasBacklight = !!cap.brightness
  return {
    dim: dim,
    gammaPercent: gamma,
    startHyprsunset: dim && cap.hyprsunsetRunning !== true,
    // Under gamma-only dimming the backlight is left alone unless the user
    // configured a floor below 100%.
    setBacklight: hasBacklight && backlight < 100 && backlight !== cap.brightness.percent,
    backlightPercent: backlight
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BACKLIGHT_DEVICE: BACKLIGHT_DEVICE,
    GAMMA_TRIES: GAMMA_TRIES,
    GAMMA_INTERVAL_S: GAMMA_INTERVAL_S,
    brightnessGetCommand: brightnessGetCommand,
    parseBrightness: parseBrightness,
    brightnessSetRawCommand: brightnessSetRawCommand,
    brightnessSetPercentCommand: brightnessSetPercentCommand,
    clampPercent: clampPercent,
    hyprsunsetRunningCommand: hyprsunsetRunningCommand,
    parseRunning: parseRunning,
    hyprsunsetStartCommand: hyprsunsetStartCommand,
    hyprsunsetStopCommand: hyprsunsetStopCommand,
    gammaQueryCommand: gammaQueryCommand,
    parseGamma: parseGamma,
    clampGamma: clampGamma,
    gammaApplyCommand: gammaApplyCommand,
    identityCommand: identityCommand,
    plan: plan
  }
}
