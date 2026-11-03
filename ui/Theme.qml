import QtQuick

// Palette + typography resolver shared by every Get The F Up surface.
//
// Reads `service.palette` (Palette.resolve output) and `service.config.ui`.
// When the service is not up yet (it can be null briefly at startup) every
// token falls back to the Claude Code preset from SPEC.md §3, so nothing
// ever renders with undefined colors.
//
// `paletteOverride` / `uiOverride` let the settings panel preview an unsaved
// draft without touching the live service.
QtObject {
  id: root

  property var service: null
  property var paletteOverride: null
  property var uiOverride: null

  readonly property var claudePreset: ({
    background: "#000000",
    foreground: "#f0eee6",
    dim: "#8f8f88",
    accent: "#d97757",
    border: "#3a3a37",
    error: "#cc6666",
    success: "#6a9bcc"
  })

  readonly property var tokens: {
    var source = root.paletteOverride
      || (root.service && root.service.palette ? root.service.palette : null)
    var out = {}
    for (var key in root.claudePreset) {
      var value = source ? source[key] : undefined
      out[key] = (typeof value === "string" && value !== "") ? value : root.claudePreset[key]
    }
    return out
  }

  readonly property var ui: root.uiOverride
    || (root.service && root.service.config && root.service.config.ui ? root.service.config.ui : ({}))

  readonly property color background: tokens.background
  readonly property color foreground: tokens.foreground
  readonly property color dim: tokens.dim
  readonly property color accent: tokens.accent
  readonly property color border: tokens.border
  readonly property color error: tokens.error
  readonly property color success: tokens.success

  // Derived surfaces: tints of the foreground over the (black) background.
  readonly property color surface: alpha(foreground, 0.035)
  readonly property color surfaceHover: alpha(foreground, 0.07)
  readonly property color surfacePressed: alpha(foreground, 0.12)
  readonly property color faint: alpha(dim, 0.55)

  readonly property string fontFamily: (typeof ui.fontFamily === "string" && ui.fontFamily !== "")
    ? ui.fontFamily : "JetBrainsMono Nerd Font"

  function alpha(c, a) {
    return Qt.rgba(c.r, c.g, c.b, a)
  }
}
