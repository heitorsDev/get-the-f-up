.pragma library

// Alarm audio: sink resolution, volume/mute capture and forcing, and the
// looping player. Pure command builders and output parsers.
//
// pactl (pipewire-pulse) is used rather than wpctl because wpctl on this
// machine only accepts numeric node ids, while the config names sinks.

// Every alarm player process carries this marker in its argv so the restore
// script can find and kill it even after the shell crashed.
var PLAYER_MARKER = "omarchy-sleep-mode-alarm"
var FREEDESKTOP_ALARM = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"

function listSinksCommand() {
  return ["pactl", "list", "short", "sinks"]
}

// "55\talsa_output...\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED" -> ["alsa_output..."]
function parseSinkList(text) {
  var out = []
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line) continue
    var parts = line.split(/\t+/)
    if (parts.length < 2) parts = line.split(/\s+/)
    if (parts.length >= 2 && parts[1]) out.push(parts[1])
  }
  return out
}

function defaultSinkCommand() {
  return ["pactl", "get-default-sink"]
}

function parseDefaultSink(text) {
  var line = String(text || "").split("\n")[0].trim()
  return line && line.indexOf(" ") === -1 ? line : ""
}

// The configured sink if it is present, otherwise the current default sink.
// -> { sink, fallback, reason }
function resolveSink(configured, sinks, defaultSink) {
  var list = sinks || []
  var want = configured ? String(configured) : ""
  var def = defaultSink ? String(defaultSink) : ""
  if (want && list.indexOf(want) !== -1) return { sink: want, fallback: false, reason: "" }
  if (def) {
    return { sink: def, fallback: !!want,
      reason: want ? "configured sink " + want + " unavailable; using default" : "" }
  }
  if (list.length > 0) {
    return { sink: list[0], fallback: true, reason: "no default sink; using " + list[0] }
  }
  return { sink: "", fallback: true, reason: "no sinks available" }
}

// One process that prints the sink list and the default sink in sections.
function sinkProbeCommand() {
  return ["bash", "-c",
    "echo '@@sinks'; pactl list short sinks 2>/dev/null; echo '@@default'; pactl get-default-sink 2>/dev/null; exit 0"]
}

// Volume and mute of one sink, in sections.
function captureCommand(sink) {
  return ["bash", "-c",
    "echo '@@volume'; pactl get-sink-volume \"$1\" 2>/dev/null; echo '@@mute'; pactl get-sink-mute \"$1\" 2>/dev/null; exit 0",
    "sleep-mode-audio", String(sink || "")]
}

// "Volume: front-left: 52428 /  80% / -5.81 dB,   front-right: 52428 /  80% / -5.81 dB"
// -> { raw: [52428, 52428], percent: [80, 80] }   (null when unparsable)
function parseVolume(text) {
  var re = /(\d+)\s*\/\s*(\d+)%/g
  var raw = []
  var percent = []
  var m
  var s = String(text || "")
  while ((m = re.exec(s)) !== null) {
    raw.push(parseInt(m[1], 10))
    percent.push(parseInt(m[2], 10))
  }
  return raw.length ? { raw: raw, percent: percent } : null
}

// "Mute: yes" -> true, "Mute: no" -> false, otherwise null.
function parseMute(text) {
  var m = String(text || "").match(/Mute:\s*(yes|no)/i)
  if (!m) return null
  return m[1].toLowerCase() === "yes"
}

function clampVolume(percent) {
  var n = Math.round(Number(percent))
  if (isNaN(n)) n = 80
  return Math.max(0, Math.min(150, n))
}

function setVolumeCommand(sink, percent) {
  return ["pactl", "set-sink-volume", String(sink), clampVolume(percent) + "%"]
}

function setVolumeRawCommand(sink, raw) {
  var cmd = ["pactl", "set-sink-volume", String(sink)]
  for (var i = 0; i < raw.length; i++) cmd.push(String(Math.max(0, Math.round(raw[i]))))
  return cmd
}

function setMuteCommand(sink, muted) {
  return ["pactl", "set-sink-mute", String(sink), muted ? "1" : "0"]
}

// Force the alarm volume and (optionally) clear mute in one process.
function forceCommand(sink, audioConfig) {
  var cfg = audioConfig || {}
  var script = ""
  if (cfg.unmute !== false) script += "pactl set-sink-mute \"$1\" 0; "
  script += "pactl set-sink-volume \"$1\" \"$2\"; exit 0"
  return ["bash", "-c", script, "sleep-mode-audio", String(sink),
    clampVolume(cfg.volumePercent === undefined ? 80 : cfg.volumePercent) + "%"]
}

// Sound files to try, in order: the user's file, the bundled alarm, the
// freedesktop alarm.
function soundCandidates(audioConfig, pluginDir) {
  var out = []
  var user = audioConfig && audioConfig.soundPath ? String(audioConfig.soundPath) : ""
  if (user) out.push(user)
  if (pluginDir) out.push(String(pluginDir).replace(/\/+$/, "") + "/assets/alarm.oga")
  out.push(FREEDESKTOP_ALARM)
  return out
}

// Prints the first readable candidate (empty output if none).
function pickSoundCommand(candidates) {
  return ["bash", "-c", "for f in \"$@\"; do [ -r \"$f\" ] && { printf '%s\\n' \"$f\"; exit 0; }; done; exit 1",
    "sleep-mode-sound"].concat(candidates || [])
}

function parsePickedSound(text) {
  return String(text || "").split("\n")[0].trim()
}

// mpv audio-device names for PipeWire sinks are "pipewire/<node.name>"
// (verified with `mpv --audio-device=help`).
function mpvDevice(sink) {
  return sink ? "pipewire/" + sink : "auto"
}

// The looping player. mpv is exec'd so the Process pid is mpv's own; without
// mpv a shell loop over pw-play/paplay is the fallback (neither loops itself).
// argv[0] of the bash script is PLAYER_MARKER, and mpv gets it as --title, so
// both forms are findable with `pkill -f PLAYER_MARKER`.
function playerCommand(sink, file) {
  var script = [
    "sink=\"$1\"; file=\"$2\"; device=\"$3\"",
    "if command -v mpv >/dev/null 2>&1; then",
    "  exec mpv --loop=inf --no-video --really-quiet --no-terminal --title=\"$0\" --audio-device=\"$device\" \"$file\"",
    "fi",
    "while :; do",
    "  if [ -n \"$sink\" ]; then pw-play --target \"$sink\" \"$file\" || paplay -d \"$sink\" \"$file\" || sleep 1",
    "  else pw-play \"$file\" || paplay \"$file\" || sleep 1; fi",
    "done"
  ].join("\n")
  return ["bash", "-c", script, PLAYER_MARKER, String(sink || ""), String(file), mpvDevice(sink)]
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PLAYER_MARKER: PLAYER_MARKER,
    FREEDESKTOP_ALARM: FREEDESKTOP_ALARM,
    listSinksCommand: listSinksCommand,
    parseSinkList: parseSinkList,
    defaultSinkCommand: defaultSinkCommand,
    parseDefaultSink: parseDefaultSink,
    resolveSink: resolveSink,
    sinkProbeCommand: sinkProbeCommand,
    captureCommand: captureCommand,
    parseVolume: parseVolume,
    parseMute: parseMute,
    clampVolume: clampVolume,
    setVolumeCommand: setVolumeCommand,
    setVolumeRawCommand: setVolumeRawCommand,
    setMuteCommand: setMuteCommand,
    forceCommand: forceCommand,
    soundCandidates: soundCandidates,
    pickSoundCommand: pickSoundCommand,
    parsePickedSound: parsePickedSound,
    mpvDevice: mpvDevice,
    playerCommand: playerCommand
  }
}
