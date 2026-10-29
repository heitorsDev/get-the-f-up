.pragma library

// Config defaults, merging, parsing and paths for
// ~/.config/omarchy/sleep-mode/config.json. Pure: no I/O. See SPEC.md §16.

var CONFIG_VERSION = 1

function mathStep(operators) {
  return { type: "math", operators: operators, maxOperand: 20, tier: "easy" }
}

function defaults() {
  return {
    version: CONFIG_VERSION,

    display: {
      dimMethod: "gamma",
      gammaPercent: 50,
      laptopBacklightPercent: 100,
      restoreBrightness: true
    },

    audio: {
      soundPath: null,
      sink: "alsa_output.pci-0000_00_1f.3.analog-stereo",
      volumePercent: 80,
      unmute: true,
      restoreVolume: true
    },

    camera: {
      enabled: true,
      device: "/dev/video0",
      lightThreshold: 60,
      nearBlackCutoff: 24,
      autoSkipAfterFailures: 3,
      warnOnArm: true,
      // The light gate: while on, the challenges are locked unless the room
      // light is on. It runs alongside the challenges, not as a step.
      requireLight: false
    },

    challenge: {
      defaultPreset: "standard",
      reps: 1,
      presets: {
        standard: {
          shuffle: false,
          steps: [mathStep("+-"), mathStep("+-"), mathStep("+-")]
        },
        thorough: {
          shuffle: false,
          steps: [{ type: "string", charset: "alnum", length: 8 }, mathStep("+-x"), mathStep("+-x"), mathStep("+-x")]
        },
        quick: {
          shuffle: false,
          steps: [{ type: "string", charset: "alnum", length: 8 }]
        }
      },
      pool: {
        math: { weight: 3, operators: "+-x", maxOperand: 20 },
        string: { weight: 2, charset: "alnum", length: 8 },
        memory: { weight: 1, length: 4 }
      }
    },

    lockdown: {
      coverAllMonitors: true,
      exclusiveKeyboard: true,
      suppressNotifications: true,
      pauseMedia: true,
      hideBar: true,
      blockWindowSwitching: true,
      suppressIdle: true,
      maxDurationMinutes: 0
    },

    ui: {
      palette: "theme",
      claudePalette: {
        background: "#000000",
        foreground: "#f0eee6",
        dim: "#8f8f88",
        accent: "#d97757",
        border: "#3a3a37",
        error: "#cc6666",
        success: "#6a9bcc"
      },
      fontFamily: "JetBrainsMono Nerd Font",
      clock24h: true,
      showSeconds: true,
      showRingTime: true,
      showCountdown: true,
      showDate: false,
      pulseOnRing: false
    },

    safety: {
      emergencyExit: false,
      watchdog: true
    }
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function clone(v) {
  if (v === undefined) return undefined
  return JSON.parse(JSON.stringify(v))
}

// A value from the user's file is accepted only when it has the same shape as
// the default it replaces; anything else silently falls back to the default.
// Keys that have no default (forward-compatible additions) are kept as-is.
// Keys whose value may be null (meaning "use the system default").
var NULLABLE = { "audio.soundPath": true, "audio.sink": true }

function compatible(def, value, keyPath) {
  if (value === undefined) return false
  if (value === null && NULLABLE[keyPath]) return true
  if (def === null) return value === null || typeof value === "string"
  if (Array.isArray(def)) return Array.isArray(value)
  if (isPlainObject(def)) return isPlainObject(value)
  if (typeof def === "number") return typeof value === "number" && isFinite(value)
  return typeof value === typeof def
}

function mergeInto(def, partial, prefix) {
  var out = clone(def)
  var key
  for (key in partial) {
    if (!partial.hasOwnProperty(key)) continue
    var value = partial[key]
    if (!out.hasOwnProperty(key)) {
      if (value !== undefined) out[key] = clone(value)
      continue
    }
    var keyPath = prefix ? prefix + "." + key : key
    if (!compatible(out[key], value, keyPath)) continue
    if (isPlainObject(out[key])) out[key] = mergeInto(out[key], value, keyPath)
    else out[key] = clone(value)
  }
  return out
}

function normalizePreset(preset) {
  var steps = []
  var raw = isPlainObject(preset) && Array.isArray(preset.steps) ? preset.steps : []
  for (var i = 0; i < raw.length; i++) {
    if (isPlainObject(raw[i]) && typeof raw[i].type === "string") steps.push(clone(raw[i]))
  }
  return { shuffle: isPlainObject(preset) && preset.shuffle === true, steps: steps }
}

// Deep-merge `partial` over defaults(). Arrays replace. `challenge.presets`
// replaces as a whole (so a preset deleted in settings stays deleted); each
// entry is taken verbatim, never merged with a default preset of the same name.
function merge(partial) {
  var base = defaults()
  if (!isPlainObject(partial)) return base

  var presets = null
  if (isPlainObject(partial.challenge) && isPlainObject(partial.challenge.presets)) {
    presets = partial.challenge.presets
  }

  var out = mergeInto(base, partial, "")

  if (presets !== null) {
    var names = []
    var key
    for (key in presets) if (presets.hasOwnProperty(key)) names.push(key)
    if (names.length > 0) {
      out.challenge.presets = {}
      for (var i = 0; i < names.length; i++) {
        out.challenge.presets[names[i]] = normalizePreset(presets[names[i]])
      }
    } else {
      out.challenge.presets = base.challenge.presets
    }
  }

  if (!out.challenge.presets.hasOwnProperty(out.challenge.defaultPreset)) {
    out.challenge.defaultPreset = presetNames(out)[0]
  }
  out.challenge.reps = Math.max(1, Math.floor(out.challenge.reps))
  out.version = CONFIG_VERSION
  return out
}

function parse(text) {
  var src = text === undefined || text === null ? "" : String(text)
  if (src.replace(/\s+/g, "").length === 0) {
    return { config: defaults(), error: "config file is empty" }
  }
  var data
  try {
    data = JSON.parse(src)
  } catch (e) {
    return { config: defaults(), error: "config is not valid JSON: " + e.message }
  }
  if (!isPlainObject(data)) {
    return { config: defaults(), error: "config must be a JSON object" }
  }
  return { config: merge(data), error: "" }
}

function serialize(config) {
  return JSON.stringify(config, null, 2) + "\n"
}

function configPath(home) {
  return home + "/.config/omarchy/sleep-mode/config.json"
}

function stateDir(home) {
  return home + "/.local/state/omarchy/sleep-mode"
}

function historyPath(home) {
  return stateDir(home) + "/history.json"
}

function activePath(home) {
  return stateDir(home) + "/active.json"
}

function presetNames(config) {
  var names = []
  var presets = config && config.challenge && config.challenge.presets
  if (!isPlainObject(presets)) return names
  for (var key in presets) if (presets.hasOwnProperty(key)) names.push(key)
  return names
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG_VERSION: CONFIG_VERSION,
    defaults: defaults,
    merge: merge,
    parse: parse,
    serialize: serialize,
    configPath: configPath,
    stateDir: stateDir,
    historyPath: historyPath,
    activePath: activePath,
    presetNames: presetNames
  }
}
