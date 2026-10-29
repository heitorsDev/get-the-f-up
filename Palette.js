.pragma library

// Color tokens for the sleep screen and panels. Either the Claude Code preset
// (SPEC.md §3) or the live Omarchy theme, read from the shell's qs.Commons
// `Color` singleton (/usr/share/omarchy/shell/Commons/Color.qml), which exposes
// foreground, background, accent, urgent, muted and per-surface groups such as
// popups.border. Missing theme keys fall back to the Claude preset.

var TOKENS = ["background", "foreground", "dim", "accent", "border", "error", "success"]

var CLAUDE = {
  background: "#000000",
  foreground: "#f0eee6",
  dim: "#8f8f88",
  accent: "#d97757",
  border: "#3a3a37",
  error: "#cc6666",
  success: "#6a9bcc"
}

// Theme keys tried in order for each token. Dotted keys reach into a nested
// group (popups.border); flat keys also cover plain colors.toml-style maps.
var THEME_KEYS = {
  background: ["background", "color0"],
  foreground: ["foreground", "color7"],
  dim: ["muted", "dim", "color8"],
  accent: ["accent", "color4"],
  border: ["popups.border", "border", "menu.border"],
  error: ["urgent", "error", "red", "color1"],
  success: ["success", "green", "color2"]
}

function hex2(n) {
  var v = Math.max(0, Math.min(255, Math.round(n * 255)))
  return (v < 16 ? "0" : "") + v.toString(16)
}

// Accepts "#rgb", "#rrggbb", "#aarrggbb" strings or a QML color value
// ({ r, g, b, a } in 0..1, as a `color` property arrives in JS). Returns a
// lowercase "#rrggbb" (or "#aarrggbb" when translucent, QML's order) or null.
function normalizeColor(value) {
  if (value === null || value === undefined) return null
  if (typeof value === "object" && typeof value.r === "number" && typeof value.g === "number" && typeof value.b === "number") {
    var rgb = hex2(value.r) + hex2(value.g) + hex2(value.b)
    var a = typeof value.a === "number" ? value.a : 1
    return a >= 1 ? "#" + rgb : "#" + hex2(a) + rgb
  }
  var s = String(value).replace(/^\s+|\s+$/g, "").toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3)
  if (/^#[0-9a-f]{6}$/.test(s) || /^#[0-9a-f]{8}$/.test(s)) return s
  return null
}

function lookup(theme, key) {
  var parts = key.split(".")
  var v = theme
  for (var i = 0; i < parts.length; i++) {
    if (v === null || v === undefined || typeof v !== "object") return undefined
    v = v[parts[i]]
  }
  return v
}

function claudePreset() {
  var out = {}
  for (var k in CLAUDE) if (CLAUDE.hasOwnProperty(k)) out[k] = CLAUDE[k]
  return out
}

function fromTheme(theme) {
  var out = claudePreset()
  if (!theme || typeof theme !== "object") return out
  for (var i = 0; i < TOKENS.length; i++) {
    var token = TOKENS[i]
    var keys = THEME_KEYS[token]
    for (var j = 0; j < keys.length; j++) {
      var c = normalizeColor(lookup(theme, keys[j]))
      if (c !== null) { out[token] = c; break }
    }
  }
  return out
}

// uiConfig.palette "claude" -> claudePalette over the preset (background
// included); anything else -> the theme, always on a pure black background.
function resolve(uiConfig, theme) {
  var ui = uiConfig || {}
  var out
  if (ui.palette === "claude") {
    out = claudePreset()
    var custom = ui.claudePalette || {}
    for (var i = 0; i < TOKENS.length; i++) {
      var c = normalizeColor(custom[TOKENS[i]])
      if (c !== null) out[TOKENS[i]] = c
    }
    return out
  }
  out = fromTheme(theme)
  out.background = "#000000"
  return out
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TOKENS: TOKENS,
    claudePreset: claudePreset,
    fromTheme: fromTheme,
    resolve: resolve,
    normalizeColor: normalizeColor
  }
}
