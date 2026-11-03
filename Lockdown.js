.pragma library

// Lockdown and session plumbing: idle suppression, notification DND, bar
// hiding, media pause selection, the crash watchdog unit, and the restore
// record shared with bin/get-the-f-up-restore. Pure builders and parsers.

var INHIBIT_MARKER = "omarchy-get-the-f-up-inhibit"
var WATCHDOG_UNIT = "omarchy-get-the-f-up-watchdog"
var EMERGENCY_PHRASE = "i am awake"
// Environment the transient watchdog unit needs to reach Hyprland, PipeWire
// and the shell. Only variables set in the shell's environment are passed.
var WATCHDOG_ENV = ["HOME", "PATH", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "WAYLAND_DISPLAY",
  "HYPRLAND_INSTANCE_SIGNATURE", "OMARCHY_PATH", "DBUS_SESSION_BUS_ADDRESS"]

// ------------------------------------------------------------------ paths

function stayAwakePath(home) {
  return String(home) + "/.local/state/omarchy/indicators/stay-awake"
}

function barOffPath(home) {
  return String(home) + "/.local/state/omarchy/toggles/bar-off"
}

// file:///a/b%20c/ -> /a/b c
function urlToPath(url) {
  var s = String(url || "")
  if (s.indexOf("file://") === 0) s = s.substring(7)
  try { s = decodeURIComponent(s) } catch (e) { /* keep as is */ }
  while (s.length > 1 && s.charAt(s.length - 1) === "/") s = s.substring(0, s.length - 1)
  return s
}

// ------------------------------------------------------------ sections

// "@@name\n...\n@@other\n..." -> { name: "...", other: "..." }
function splitSections(text) {
  var out = {}
  var current = null
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var m = line.match(/^@@([A-Za-z0-9_-]+)\s*$/)
    if (m) {
      current = m[1]
      out[current] = ""
    } else if (current !== null) {
      out[current] += (out[current] ? "\n" : "") + line
    }
  }
  for (var k in out) out[k] = out[k].replace(/\s+$/, "")
  return out
}

function yes(text) {
  return String(text || "").trim() === "yes"
}

// ----------------------------------------------------- arm-time capture

// One process that captures every piece of pre-session state.
function captureCommand(home, backlightDevice) {
  var script = [
    "home=\"$1\"; dev=\"$2\"",
    "echo '@@brightness'; brightnessctl -d \"$dev\" -m 2>/dev/null",
    "echo '@@hyprsunset'; if pgrep -x hyprsunset >/dev/null; then echo yes; else echo no; fi",
    "echo '@@gamma'; pgrep -x hyprsunset >/dev/null && hyprctl hyprsunset gamma 2>/dev/null",
    "echo '@@stayawake'; [ -e \"$home/.local/state/omarchy/indicators/stay-awake\" ] && echo yes || echo no",
    "echo '@@baroff'; [ -e \"$home/.local/state/omarchy/toggles/bar-off\" ] && echo yes || echo no",
    "echo '@@dnd'; omarchy-shell notifications dndState 2>/dev/null",
    "exit 0"
  ].join("\n")
  return ["bash", "-c", script, "get-the-f-up-capture", String(home), String(backlightDevice || "intel_backlight")]
}

// "on"/"off" from `omarchy-shell notifications dndState`; null when unreachable.
function parseDnd(text) {
  var s = String(text || "").trim().toLowerCase()
  if (s === "on") return true
  if (s === "off") return false
  return null
}

// Raw sections -> { brightnessText, hyprsunsetRunning, gammaText, stayAwake, barOff, dnd }.
// Brightness and gamma text are parsed by Display.parseBrightness/parseGamma.
function parseCapture(text) {
  var s = splitSections(text)
  return {
    brightnessText: s.brightness || "",
    hyprsunsetRunning: yes(s.hyprsunset),
    gammaText: s.gamma || "",
    stayAwake: yes(s.stayawake),
    barOff: yes(s.baroff),
    dnd: parseDnd(s.dnd)
  }
}

// ------------------------------------------------------------- planning

function plan(lockdownConfig, captured) {
  var cfg = lockdownConfig || {}
  var cap = captured || {}
  var suppressIdle = cfg.suppressIdle !== false
  return {
    // Never touch a stay-awake file the user already had.
    touchStayAwake: suppressIdle && cap.stayAwake !== true,
    holdInhibitor: suppressIdle,
    hideBar: cfg.hideBar !== false && cap.barOff !== true,
    // Only when DND is reachable and currently off; if it was already on we
    // leave it on and do not turn it off afterwards.
    setDnd: cfg.suppressNotifications !== false && cap.dnd === false,
    pauseMedia: cfg.pauseMedia !== false
  }
}

// Apply the lockdown file/IPC toggles in one process.
function applyCommand(home, lockdownPlan) {
  var p = lockdownPlan || {}
  var lines = ["home=\"$1\""]
  if (p.touchStayAwake) {
    lines.push("mkdir -p \"$home/.local/state/omarchy/indicators\" && touch \"$home/.local/state/omarchy/indicators/stay-awake\"")
  }
  if (p.hideBar) {
    lines.push("mkdir -p \"$home/.local/state/omarchy/toggles\" && touch \"$home/.local/state/omarchy/toggles/bar-off\"")
    lines.push("omarchy-shell -q omarchy.bar syncHidden")
  }
  if (p.setDnd) {
    lines.push("omarchy-shell -q notifications setDnd on")
    lines.push("omarchy-shell -q omarchy.indicators refresh")
  }
  lines.push("exit 0")
  return ["bash", "-c", lines.join("\n"), "get-the-f-up-lockdown", String(home)]
}

// Held for the whole session. The child exits on its own when the shell
// process dies, so a crash never leaves an orphaned inhibitor behind.
function inhibitCommand(shellPid) {
  return ["systemd-inhibit", "--what=idle", "--who=" + INHIBIT_MARKER,
    "--why=Get The F Up is active", "--mode=block",
    "bash", "-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 5; done", INHIBIT_MARKER, String(shellPid)]
}

// argv form on purpose: wrapping in `bash -c` would put the marker in the
// wrapper's own command line and pkill would kill the wrapper.
function releaseInhibitCommand() {
  return ["pkill", "-f", INHIBIT_MARKER]
}

// players: [{ isPlaying, canPause, canTogglePlaying }] -> indices to pause.
function pauseTargets(players) {
  var out = []
  var list = players || []
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    if (p && p.isPlaying && (p.canPause || p.canTogglePlaying)) out.push(i)
  }
  return out
}

// ------------------------------------------------------ restore record

// The record bin/get-the-f-up-restore acts on. Written before any change is
// made, so every flag describes an intended change; the restore steps are
// idempotent and safe if the change never happened.
// opts: { pid, startedAt, dryRun, display: displayConfig, audio: audioConfig,
//         brightness: Display.parseBrightness()|null, hyprsunsetRunning, previousGamma,
//         displayPlan: Display.plan(), lockdownPlan: plan() }
function makeRecord(opts) {
  var o = opts || {}
  var dp = o.displayPlan || {}
  var lp = o.lockdownPlan || {}
  var b = o.brightness || null
  var dcfg = o.display || {}
  return {
    version: 1,
    pid: Number(o.pid) || 0,
    startedAt: Number(o.startedAt) || 0,
    dryRun: o.dryRun === true,
    display: {
      device: b ? b.device : "intel_backlight",
      brightnessRaw: b ? b.raw : null,
      restoreBrightness: dcfg.restoreBrightness !== false && !!b,
      gammaApplied: dp.dim === true,
      hyprsunsetWasRunning: o.hyprsunsetRunning === true,
      startedHyprsunset: dp.startHyprsunset === true,
      previousGamma: o.previousGamma === null || o.previousGamma === undefined ? 100 : Number(o.previousGamma)
    },
    audio: null,
    lockdown: {
      stayAwakeCreated: lp.touchStayAwake === true,
      barOffCreated: lp.hideBar === true,
      dndSet: lp.setDnd === true,
      inhibitor: lp.holdInhibitor === true
    }
  }
}

// Ring-time audio section. volume: Audio.parseVolume()|null, muted: bool|null.
function withAudio(record, sink, volume, muted, audioConfig) {
  var next = JSON.parse(JSON.stringify(record || {}))
  next.audio = {
    sink: String(sink || ""),
    volumeRaw: volume ? volume.raw : null,
    muted: muted === null || muted === undefined ? null : !!muted,
    restoreVolume: !(audioConfig && audioConfig.restoreVolume === false),
    playerPid: 0
  }
  return next
}

function withPlayerPid(record, pid) {
  var next = JSON.parse(JSON.stringify(record || {}))
  if (next.audio) next.audio.playerPid = Number(pid) || 0
  return next
}

// -------------------------------------------------------------- io helpers

function mkdirCommand(dirs) {
  return ["mkdir", "-p"].concat(dirs || [])
}

// Atomic write: tmp file + rename.
function writeFileCommand(path, text) {
  return ["bash", "-c",
    "mkdir -p \"$(dirname \"$1\")\" && printf '%s' \"$2\" > \"$1.tmp\" && mv -f \"$1.tmp\" \"$1\"",
    "get-the-f-up-write", String(path), String(text)]
}

function existsCommand(path) {
  return ["test", "-e", String(path)]
}

function restoreCommand(pluginDir) {
  return ["bash", String(pluginDir) + "/bin/get-the-f-up-restore"]
}

// Replace any previous watchdog unit, then start a fresh one that waits for
// the shell pid to die.
function watchdogStartCommand(pluginDir, shellPid) {
  var script = [
    "unit=\"$1\"; watchdog=\"$2\"; pid=\"$3\"; shift 3",
    "systemctl --user stop \"$unit.service\" >/dev/null 2>&1",
    "systemctl --user reset-failed \"$unit.service\" >/dev/null 2>&1",
    "args=()",
    "for v in \"$@\"; do [ -n \"${!v:-}\" ] && args+=(\"--setenv=$v\"); done",
    "exec systemd-run --user --quiet --collect --unit=\"$unit\" --description='Get The F Up crash watchdog' \"${args[@]}\" -- bash \"$watchdog\" \"$pid\""
  ].join("\n")
  return ["bash", "-c", script, "get-the-f-up-watchdog-start", WATCHDOG_UNIT,
    String(pluginDir) + "/bin/get-the-f-up-watchdog", String(shellPid)].concat(WATCHDOG_ENV)
}

function watchdogStopCommand() {
  return ["systemctl", "--user", "stop", WATCHDOG_UNIT + ".service"]
}

function toastCommand(headline, body) {
  var cmd = ["omarchy-notification-send", "-g", "\udb81\udcb2", String(headline || "Get The F Up")]
  if (body) cmd.push(String(body))
  return cmd
}

// ---------------------------------------------------------------- safety

function normalizePhrase(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")
}

function emergencyAccepted(safetyConfig, confirmation) {
  if (!safetyConfig || safetyConfig.emergencyExit !== true) return false
  return normalizePhrase(confirmation) === EMERGENCY_PHRASE
}

function maxDurationReached(lockdownConfig, armedAt, now) {
  var m = Number(lockdownConfig && lockdownConfig.maxDurationMinutes)
  if (!(m > 0)) return false
  return Number(now) - Number(armedAt) >= m * 60000
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    INHIBIT_MARKER: INHIBIT_MARKER,
    WATCHDOG_UNIT: WATCHDOG_UNIT,
    EMERGENCY_PHRASE: EMERGENCY_PHRASE,
    WATCHDOG_ENV: WATCHDOG_ENV,
    stayAwakePath: stayAwakePath,
    barOffPath: barOffPath,
    urlToPath: urlToPath,
    splitSections: splitSections,
    captureCommand: captureCommand,
    parseDnd: parseDnd,
    parseCapture: parseCapture,
    plan: plan,
    applyCommand: applyCommand,
    inhibitCommand: inhibitCommand,
    releaseInhibitCommand: releaseInhibitCommand,
    pauseTargets: pauseTargets,
    makeRecord: makeRecord,
    withAudio: withAudio,
    withPlayerPid: withPlayerPid,
    mkdirCommand: mkdirCommand,
    writeFileCommand: writeFileCommand,
    existsCommand: existsCommand,
    restoreCommand: restoreCommand,
    watchdogStartCommand: watchdogStartCommand,
    watchdogStopCommand: watchdogStopCommand,
    toastCommand: toastCommand,
    normalizePhrase: normalizePhrase,
    emergencyAccepted: emergencyAccepted,
    maxDurationReached: maxDurationReached
  }
}
