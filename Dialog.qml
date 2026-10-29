pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "ui"
import "Config.js" as Config
import "Time.js" as Time
import "Steps.js" as Steps

// The arming form (SPEC §9).
//
// Wall clock *or* duration, the challenge preset, N complete challenges, a
// live preview of the sleep screen and the arm button. The preset is
// described by its pool and its difficulty, never by the literal problems,
// so a shuffled preset does not leak its answers.
Item {
  id: root

  property var theme: fallbackTheme
  property var service: null

  // True while the arming form is actually on screen. The form is built
  // with the popout, so "visible" alone is not enough to decide that the
  // camera may be probed.
  property bool active: false

  signal previewRequested(string variant)
  signal dryRunRequested()
  signal closeRequested()
  signal armed()

  // ---- form state --------------------------------------------------------
  property string mode: "time" // "time" | "duration"
  property string timeText: ""
  property string durationText: ""
  property string presetName: ""
  property int reps: 1
  property bool removeCamera: false
  property string errorText: ""

  property real previewNow: Date.now()

  readonly property var config: root.service && root.service.config ? root.service.config : ({})

  readonly property var presetNames: Config.presetNames(root.config)

  readonly property string cameraPrecheck: root.service ? String(root.service.cameraPrecheck || "unknown") : "unknown"
  readonly property bool cameraBlocked: root.cameraPrecheck === "blocked"

  function defaultPresetName() {
    var challenge = root.config.challenge ? root.config.challenge : ({})
    var names = root.presetNames
    if (challenge.defaultPreset && names.indexOf(String(challenge.defaultPreset)) >= 0) {
      return String(challenge.defaultPreset)
    }
    return names.length > 0 ? String(names[0]) : ""
  }

  function presetSpec(name) {
    var challenge = root.config.challenge ? root.config.challenge : ({})
    var presets = challenge.presets ? challenge.presets : ({})
    return presets[name] ? presets[name] : null
  }

  function presetUsesCamera() {
    var spec = root.presetSpec(root.presetName)
    if (!spec) return false
    if (spec.shuffle === true) {
      var challenge = root.config.challenge ? root.config.challenge : ({})
      var pool = challenge.pool ? challenge.pool : ({})
      for (var key in pool) {
        if (pool.hasOwnProperty(key) && key === "camera") return true
      }
      return false
    }
    var steps = spec.steps ? spec.steps : []
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] && steps[i].type === "camera") return true
    }
    return false
  }

  // The pool and the difficulty, never the problems themselves.
  readonly property string presetSummary: {
    var spec = root.presetSpec(root.presetName)
    if (!spec) return ""
    if (spec.shuffle === true) {
      var challenge = root.config.challenge ? root.config.challenge : ({})
      var pool = challenge.pool ? challenge.pool : ({})
      var drawn = []
      for (var key in pool) {
        if (!pool.hasOwnProperty(key)) continue
        var entry = pool[key]
        var copy = {}
        for (var k in entry) copy[k] = entry[k]
        delete copy.weight
        copy.type = key
        var weight = typeof entry.weight === "number" ? entry.weight : 1
        drawn.push(Steps.describe(copy) + " x" + weight)
      }
      if (drawn.length === 0) return "the pool is empty"
      return "drawn at random from the pool: " + drawn.join("  ·  ")
    }
    var steps = spec.steps ? spec.steps : []
    var lines = []
    for (var i = 0; i < steps.length; i++) lines.push(Steps.describe(steps[i]))
    if (lines.length === 0) return "this preset has no steps"
    return lines.join("  ·  ")
  }

  readonly property var payload: {
    var p = { challenge: root.presetName, reps: root.reps }
    if (root.mode === "time") p.time = root.timeText
    else p.duration = root.durationText
    if (root.removeCamera) p.removeCamera = true
    return p
  }

  // The preview parses the very payload the arm button would send, so what
  // the user sees is what the service will do.
  readonly property real previewRingAt: {
    var parsed = Time.parseWhen(root.payload, Date.now())
    return parsed && parsed.ringAt ? parsed.ringAt : 0
  }

  readonly property string previewRingText: root.previewRingAt > 0
    ? Time.formatClock(root.previewRingAt, { h24: true, seconds: false }) : ""

  // ---- actions -----------------------------------------------------------
  // The camera is only ever probed while the arming form is on screen. The
  // form exists from the start (it is built with the popout), so without
  // this guard the camera would be opened at bar startup.
  function maybePrecheck() {
    if (!root.active) return
    if (!root.service || typeof root.service.precheckCamera !== "function") return
    var camera = root.config.camera ? root.config.camera : ({})
    if (camera.enabled === false || camera.warnOnArm === false) return
    if (!root.presetUsesCamera()) return
    root.service.precheckCamera()
  }

  function arm() {
    root.errorText = ""
    if (!root.service || typeof root.service.arm !== "function") {
      root.errorText = "the sleep-mode service is not running"
      return
    }
    var result = root.service.arm(root.payload)
    if (!result || result.ok === false) {
      root.errorText = String((result && result.error) || root.service.lastError || "could not arm")
      return
    }
    root.armed()
  }

  // The service can show up after the dialog was built (the bar widget
  // rebinds once the plugin service registers), so the form syncs itself
  // with the live config whenever the service changes.
  function syncFromConfig() {
    var challenge = root.config.challenge ? root.config.challenge : ({})
    root.reps = challenge.reps ? Math.max(1, Number(challenge.reps)) : 1
    var wanted = root.defaultPresetName()
    if (wanted !== root.presetName) {
      // onPresetNameChanged resets the camera opt-out and prechecks again.
      root.presetName = wanted
      return
    }
    root.maybePrecheck()
  }

  Component.onCompleted: root.syncFromConfig()

  onServiceChanged: root.syncFromConfig()

  onActiveChanged: {
    if (root.active) root.maybePrecheck()
  }

  onPresetNameChanged: {
    root.removeCamera = false
    root.maybePrecheck()
  }

  Timer {
    interval: 1000
    repeat: true
    running: true
    onTriggered: root.previewNow = Date.now()
  }

  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(10)

    // ---- when ------------------------------------------------------------
    SectionHeader {
      width: parent.width
      theme: root.theme
      text: "when"
    }

    Choice {
      theme: root.theme
      options: [
        { value: "time", label: "clock" },
        { value: "duration", label: "duration" }
      ]
      value: root.mode
      onChosen: function(value) { root.mode = String(value) }
    }

    LabeledField {
      width: parent.width
      theme: root.theme
      label: root.mode === "time" ? "ring time" : "duration"
      hint: root.mode === "time"
        ? "24-hour clock, the next future occurrence (07:30)"
        : "45m, 1h30m, 90 (minutes), 30s"
      placeholder: root.mode === "time" ? "07:30" : "45m"
      text: root.mode === "time" ? root.timeText : root.durationText
      onEdited: function(value) {
        if (root.mode === "time") root.timeText = value
        else root.durationText = value
      }
    }

    // ---- challenge -------------------------------------------------------
    SectionHeader {
      width: parent.width
      theme: root.theme
      text: "challenge"
    }

    Choice {
      width: parent.width
      theme: root.theme
      options: root.presetNames
      value: root.presetName
      onChosen: function(value) { root.presetName = String(value) }
    }

    Text {
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: root.presetSummary
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }

    Spinner {
      width: parent.width
      theme: root.theme
      label: "challenges required"
      hint: "N counts whole challenges: every step of a preset has to be solved N times"
      value: root.reps
      from: 1
      to: 10
      onModified: function(value) { root.reps = value }
    }

    // ---- camera pre-check ------------------------------------------------
    Card {
      width: parent.width
      height: cameraColumn.implicitHeight + Style.space(16) * 2
      theme: root.theme
      danger: root.cameraBlocked
      visible: root.cameraBlocked

      Column {
        id: cameraColumn
        anchors.centerIn: parent
        width: parent.width - Style.space(16) * 2
        spacing: Style.space(8)

        Text {
          width: parent.width
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: "camera appears blocked — the camera step will be skipped"
          color: root.theme.error
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.bold: true
        }

        Text {
          width: parent.width
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: "The lens reads as a black frame, so the light can never be measured. A blocked camera is skipped instead of stranding you in front of a locked screen."
          color: root.theme.dim
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }

        Button {
          theme: root.theme
          text: root.removeCamera ? "camera step removed" : "remove the camera step"
          selected: root.removeCamera
          enabled: !root.removeCamera
          onClicked: root.removeCamera = true
        }
      }
    }

    // ---- live preview ----------------------------------------------------
    SectionHeader {
      width: parent.width
      theme: root.theme
      text: "preview"
    }

    Card {
      width: parent.width
      height: Style.space(120)
      theme: root.theme

      SleepScreen {
        anchors.centerIn: parent
        theme: root.theme
        now: root.previewNow
        ringAt: root.previewRingAt
        sizeScale: 0.28
      }
    }

    Text {
      width: parent.width
      visible: root.previewRingText !== ""
      textFormat: Text.PlainText
      text: root.previewRingText !== ""
        ? "the alarm rings at " + root.previewRingText
        : ""
      color: root.theme.faint
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }

    // ---- arm -------------------------------------------------------------
    Row {
      width: parent.width
      spacing: Style.space(10)

      Button {
        theme: root.theme
        kind: "accent"
        text: "arm"
        onClicked: root.arm()
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: Math.max(0, parent.width - Style.space(120))
        wrapMode: Text.WordWrap
        visible: root.errorText !== ""
        textFormat: Text.PlainText
        text: root.errorText
        color: root.theme.error
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    // ---- see it first ----------------------------------------------------
    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: "see it first"
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }

    Flow {
      width: parent.width
      spacing: Style.space(8)

      Button {
        theme: root.theme
        compact: true
        text: "preview idle"
        tooltip: "the sleep screen while waiting. changes nothing"
        onClicked: root.previewRequested("armed")
      }

      Button {
        theme: root.theme
        compact: true
        text: "preview alarm"
        tooltip: "the WAKE UP screen. changes nothing"
        onClicked: root.previewRequested("ringing")
      }

      Button {
        theme: root.theme
        compact: true
        kind: "danger"
        text: "dry run"
        tooltip: "dims and plays the alarm for real, then restores everything"
        onClicked: root.dryRunRequested()
      }
    }
  }

  Theme { id: fallbackTheme }
}
