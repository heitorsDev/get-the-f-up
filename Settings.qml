pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "ui"
import "Config.js" as Config
import "Time.js" as Time
import "History.js" as History
import "Palette.js" as Palette

// The settings panel (SPEC §9, §12).
//
// Every control works on a deep copy of the live config, so Cancel is always
// safe: the draft is thrown away and the service's config is re-read. Save
// hands the draft to the service, which writes it to
// ~/.config/omarchy/sleep-mode/config.json.
Item {
  id: root

  property var theme: fallbackTheme
  property var service: null

  property var draft: ({})
  property string selectedPreset: ""
  property string newPresetName: ""
  property string statusText: ""
  property bool statusIsError: false
  property bool dirty: false
  // Which section is open; opening one closes the others.
  property string openSection: "test"

  signal previewRequested(string variant)
  signal dryRunRequested()

  readonly property var presets: root.draft.challenge && root.draft.challenge.presets
    ? root.draft.challenge.presets : ({})

  readonly property var presetNames: Config.presetNames(root.draft)

  readonly property var currentSteps: root.stepsFor(root.selectedPreset)
  readonly property int stepCount: root.currentSteps ? root.currentSteps.length : 0

  readonly property var poolTypes: {
    var out = []
    var pool = root.draft.challenge && root.draft.challenge.pool ? root.draft.challenge.pool : ({})
    for (var key in pool) if (pool.hasOwnProperty(key)) out.push(key)
    out.sort()
    return out
  }

  readonly property var draftPalette: Palette.resolve(root.draft.ui ? root.draft.ui : ({}), Color)

  readonly property var historyList: root.service && root.service.historyList ? root.service.historyList : []
  readonly property var historyRecent: History.recent(root.historyList, 10)
  readonly property var historyTotals: History.totals(root.historyList)

  // ---- draft plumbing ----------------------------------------------------
  function reload() {
    var base = root.service && root.service.config ? root.service.config : Config.defaults()
    root.draft = JSON.parse(JSON.stringify(base))
    var challenge = root.draft.challenge ? root.draft.challenge : ({})
    var names = Config.presetNames(root.draft)
    root.selectedPreset = challenge.defaultPreset && names.indexOf(String(challenge.defaultPreset)) >= 0
      ? String(challenge.defaultPreset)
      : (names.length > 0 ? String(names[0]) : "")
    root.dirty = false
    root.setStatus("", false)
  }

  // Every mutation ends here: the draft is replaced by an equal copy so
  // every binding that reads it re-evaluates.
  function touch() {
    root.draft = JSON.parse(JSON.stringify(root.draft))
    root.dirty = true
    autosave.restart()
  }

  // Changes are written shortly after the last edit, so there is no Save
  // button to forget. The wait lets a burst of typing become one write.
  Timer {
    id: autosave
    interval: 700
    onTriggered: root.flush()
  }

  // Write now if there is anything unsaved (also called when the panel closes).
  function flush() {
    autosave.stop()
    if (root.dirty) root.save()
  }

  function getPath(path) {
    var parts = String(path).split(".")
    var node = root.draft
    for (var i = 0; i < parts.length; i++) {
      if (node === null || node === undefined) return undefined
      node = node[parts[i]]
    }
    return node
  }

  function setPath(path, value) {
    var parts = String(path).split(".")
    var node = root.draft
    for (var i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = ({})
      node = node[parts[i]]
    }
    node[parts[parts.length - 1]] = value
    root.touch()
  }

  function boolAt(path, fallback) {
    var v = root.getPath(path)
    return typeof v === "boolean" ? v : fallback
  }

  function numAt(path, fallback) {
    var v = root.getPath(path)
    return typeof v === "number" && isFinite(v) ? v : fallback
  }

  function strAt(path, fallback) {
    var v = root.getPath(path)
    return typeof v === "string" ? v : fallback
  }

  function setStatus(text, isError) {
    root.statusText = String(text || "")
    root.statusIsError = isError === true
  }

  // ---- presets -----------------------------------------------------------
  function stepsFor(name) {
    var preset = root.presets[name]
    if (!preset || !preset.steps) return []
    return preset.steps
  }

  function writeSteps(name, steps) {
    if (!name) return
    var preset = root.presets[name] ? root.presets[name] : ({ shuffle: false })
    root.presets[name] = { shuffle: preset.shuffle === true, steps: steps }
    root.touch()
  }

  function defaultStep(type) {
    if (type === "string") return { type: "string", charset: "alnum", length: 8 }
    if (type === "memory") return { type: "memory", length: 4 }
    if (type === "camera") return { type: "camera" }
    return { type: "math", operators: "+-", maxOperand: 20, tier: "easy" }
  }

  function setStep(index, spec) {
    var steps = root.currentSteps.slice()
    if (index < 0 || index >= steps.length) return
    steps[index] = spec
    root.writeSteps(root.selectedPreset, steps)
  }

  function moveStep(index, delta) {
    var steps = root.currentSteps.slice()
    var target = index + delta
    if (target < 0 || target >= steps.length) return
    var moved = steps[index]
    steps[index] = steps[target]
    steps[target] = moved
    root.writeSteps(root.selectedPreset, steps)
  }

  function removeStep(index) {
    var steps = root.currentSteps.slice()
    if (index < 0 || index >= steps.length) return
    steps.splice(index, 1)
    root.writeSteps(root.selectedPreset, steps)
  }

  function addStep(type) {
    var steps = root.currentSteps.slice()
    steps.push(root.defaultStep(type))
    root.writeSteps(root.selectedPreset, steps)
  }

  function deleteSelectedPreset() {
    var name = root.selectedPreset
    if (!name) return
    var presets = root.presets
    delete presets[name]
    var names = Config.presetNames(root.draft)
    if (names.length === 0) {
      presets["standard"] = { shuffle: false, steps: [root.defaultStep("math")] }
      names = ["standard"]
    }
    if (root.draft.challenge.defaultPreset === name) {
      root.draft.challenge.defaultPreset = String(names[0])
    }
    root.selectedPreset = String(names[0])
    root.touch()
  }

  function addPreset() {
    var name = String(root.newPresetName || "").replace(/^\s+|\s+$/g, "")
    if (name === "") {
      root.setStatus("a preset needs a name", true)
      return
    }
    if (root.presets[name]) {
      root.setStatus("the preset \"" + name + "\" already exists", true)
      return
    }
    root.presets[name] = { shuffle: false, steps: [root.defaultStep("math")] }
    root.newPresetName = ""
    root.selectedPreset = name
    root.touch()
  }

  // ---- pool --------------------------------------------------------------
  function poolSpec(type) {
    var pool = root.draft.challenge && root.draft.challenge.pool ? root.draft.challenge.pool : ({})
    var entry = pool[type] ? pool[type] : ({})
    var spec = {}
    for (var k in entry) spec[k] = entry[k]
    delete spec.weight
    spec.type = type
    return spec
  }

  function setPoolSpec(type, spec) {
    var pool = root.draft.challenge.pool
    if (!pool[type]) return
    var next = {}
    for (var k in spec) next[k] = spec[k]
    next.weight = typeof pool[type].weight === "number" ? pool[type].weight : 1
    pool[type] = next
    root.touch()
  }

  function setPoolWeight(type, weight) {
    var pool = root.draft.challenge.pool
    if (!pool[type]) return
    var next = {}
    for (var k in pool[type]) next[k] = pool[type][k]
    next.weight = weight
    pool[type] = next
    root.touch()
  }

  // ---- save --------------------------------------------------------------
  function save() {
    if (!root.service || typeof root.service.saveConfig !== "function") {
      root.setStatus("the sleep-mode service is not running", true)
      return
    }
    var result = root.service.saveConfig(root.draft)
    if (!result || result.ok === false) {
      root.setStatus(String((result && result.error) || root.service.lastError || "could not save"), true)
      return
    }
    root.dirty = false
    root.setStatus("saved", false)
  }

  Component.onCompleted: root.reload()
  Component.onDestruction: root.flush()
  onVisibleChanged: if (!root.visible) root.flush()

  // The service can show up after the panel was built, in which case the
  // first draft was built from the defaults. Reload it once the real
  // config is reachable.
  onServiceChanged: root.reload()

  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(16)

    // ---- test -------------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "preview and test"
      summary: "see the idle and alarm screens"
      expanded: root.openSection === "test"
      onToggled: root.openSection = root.openSection === "test" ? "" : "test"

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "see the sleep screen before you rely on it. previews change nothing: no dimming, no sound, no lock, the camera stays off. a dry run is the real thing for 10 seconds."
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }

      Flow {
        width: parent.width
        spacing: Style.space(8)

        Button {
          theme: root.theme
          kind: "accent"
          text: "preview idle screen"
          tooltip: "the clock and countdown while waiting for the alarm"
          onClicked: root.previewRequested("armed")
        }

        Button {
          theme: root.theme
          kind: "accent"
          text: "preview alarm screen"
          tooltip: "WAKE UP, as it looks once the alarm rings"
          onClicked: root.previewRequested("ringing")
        }

        Button {
          theme: root.theme
          kind: "danger"
          text: "dry run"
          tooltip: "dims the display and plays the alarm for real, then restores everything"
          onClicked: root.dryRunRequested()
        }
      }
    }

    // ---- presets ----------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "challenges"
      summary: "presets, steps, pool"
      expanded: root.openSection === "challenges"
      onToggled: root.openSection = root.openSection === "challenges" ? "" : "challenges"

      Text {
        width: parent.width
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: "The default preset is what the arming dialog starts on. N counts whole challenges: every step of a preset has to be solved N times before the screen lets go."
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Choice {
        width: parent.width
        theme: root.theme
        options: root.presetNames
        value: root.strAt("challenge.defaultPreset", "")
        onChosen: function(value) { root.setPath("challenge.defaultPreset", String(value)) }
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "default challenges required"
        value: root.numAt("challenge.reps", 1)
        from: 1
        to: 10
        onModified: function(value) { root.setPath("challenge.reps", value) }
      }

      SectionHeader {
        width: parent.width
        theme: root.theme
        text: "presets"
      }

      Item {
        id: presetRow
        width: parent.width
        height: Math.max(presetChoice.implicitHeight, Style.space(30))

        Choice {
          id: presetChoice
          anchors.left: parent.left
          anchors.right: presetActions.left
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          theme: root.theme
          options: root.presetNames
          value: root.selectedPreset
          onChosen: function(value) { root.selectedPreset = String(value) }
        }

        Row {
          id: presetActions
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(6)

          Button {
            theme: root.theme
            compact: true
            kind: "danger"
            text: "delete"
            enabled: root.selectedPreset !== ""
            onClicked: root.deleteSelectedPreset()
          }
        }
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "new preset"
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      // The button is centered on the input itself, not on a label + input
      // column, so the two line up.
      Item {
        id: newPresetRow
        width: parent.width
        height: Math.max(newPresetField.implicitHeight, addPresetButton.implicitHeight)

        Field {
          id: newPresetField
          anchors.left: parent.left
          anchors.right: addPresetButton.left
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          theme: root.theme
          placeholder: "late shift"
          text: root.newPresetName
          onEdited: function(value) { root.newPresetName = value }
          onAccepted: root.addPreset()
        }

        Button {
          id: addPresetButton
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          theme: root.theme
          text: "add"
          onClicked: root.addPreset()
        }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "shuffle: draw the steps from the pool instead of using this list"
        hint: "a shuffled preset keeps its step count and picks each step at random, weighted by the pool"
        checked: root.presets[root.selectedPreset] ? root.presets[root.selectedPreset].shuffle === true : false
        onToggled: function(value) {
          var preset = root.presets[root.selectedPreset]
          if (!preset) return
          root.presets[root.selectedPreset] = { shuffle: value, steps: preset.steps ? preset.steps : [] }
          root.touch()
        }
      }

      SectionHeader {
        width: parent.width
        theme: root.theme
        text: "steps"
      }

      Repeater {
        model: root.stepCount

        Card {
          id: stepCard
          required property int index

          width: parent.width
          height: stepEditor.implicitHeight + Style.space(16) * 2

          StepEditor {
            id: stepEditor
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Style.space(16)
            theme: root.theme
            spec: root.currentSteps[stepCard.index]
            showListActions: true
            onChanged: function(spec) { root.setStep(stepCard.index, spec) }
            onMoveUpRequested: root.moveStep(stepCard.index, -1)
            onMoveDownRequested: root.moveStep(stepCard.index, 1)
            onRemoveRequested: root.removeStep(stepCard.index)
          }
        }
      }

      Item {
        id: addStepRow
        width: parent.width
        height: Math.max(addStepChoice.implicitHeight, Style.space(30))

        Choice {
          id: addStepChoice
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          theme: root.theme
          options: ["math", "string", "memory", "camera"]
          value: "math"
          // Choice only reports the click; the owner keeps the value.
          onChosen: function(chosen) { addStepChoice.value = chosen }
        }

        Button {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          theme: root.theme
          text: "add step"
          enabled: root.selectedPreset !== ""
          onClicked: root.addStep(String(addStepChoice.value))
        }
      }

      SectionHeader {
        width: parent.width
        theme: root.theme
        text: "pool"
      }

      Text {
        width: parent.width
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: "The pool is where a shuffled preset draws its steps from. The weight is how often a type is picked relative to the others."
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Repeater {
        model: root.poolTypes.length

        Card {
          id: poolCard
          required property int index

          width: parent.width
          height: poolEditor.implicitHeight + Style.space(16) * 2

          StepEditor {
            id: poolEditor
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Style.space(16)
            theme: root.theme
            spec: root.poolSpec(root.poolTypes[poolCard.index])
            showWeight: true
            weight: root.numAt("challenge.pool." + root.poolTypes[poolCard.index] + ".weight", 1)
            onChanged: function(spec) { root.setPoolSpec(root.poolTypes[poolCard.index], spec) }
            onWeightEdited: function(value) { root.setPoolWeight(root.poolTypes[poolCard.index], value) }
          }
        }
      }
    }

    // ---- display ----------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "display"
      summary: "dimming"
      expanded: root.openSection === "display"
      onToggled: root.openSection = root.openSection === "display" ? "" : "display"

      Text {
        width: parent.width
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: "Only gamma dimming is supported: the HDMI monitor has no DDC/CI, so hyprsunset is the one dimming that reaches both screens."
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "gamma while sleeping"
        hint: "hyprsunset gamma level in percent"
        value: root.numAt("display.gammaPercent", 50)
        from: 1
        to: 100
        suffix: "%"
        onModified: function(value) { root.setPath("display.gammaPercent", value) }
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "laptop backlight"
        hint: "left alone under gamma-only dimming"
        value: root.numAt("display.laptopBacklightPercent", 100)
        from: 1
        to: 100
        suffix: "%"
        onModified: function(value) { root.setPath("display.laptopBacklightPercent", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "restore the previous brightness on exit"
        checked: root.boolAt("display.restoreBrightness", true)
        onToggled: function(value) { root.setPath("display.restoreBrightness", value) }
      }
    }

    // ---- audio ------------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "audio"
      summary: "alarm sound and volume"
      expanded: root.openSection === "audio"
      onToggled: root.openSection = root.openSection === "audio" ? "" : "audio"

      LabeledField {
        width: parent.width
        theme: root.theme
        label: "alarm sound"
        hint: "leave empty for the bundled alarm"
        placeholder: "/path/to/alarm.oga"
        text: root.strAt("audio.soundPath", "")
        onEdited: function(value) { root.setPath("audio.soundPath", value === "" ? null : value) }
      }

      LabeledField {
        width: parent.width
        theme: root.theme
        label: "sink"
        hint: "leave empty for the current default sink"
        placeholder: "alsa_output.pci-0000_00_1f.3.analog-stereo"
        text: root.strAt("audio.sink", "")
        onEdited: function(value) { root.setPath("audio.sink", value === "" ? null : value) }
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "volume at ring time"
        hint: "the alarm forces this volume so it is always audible"
        value: root.numAt("audio.volumePercent", 80)
        from: 1
        to: 100
        suffix: "%"
        onModified: function(value) { root.setPath("audio.volumePercent", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "unmute at ring time"
        checked: root.boolAt("audio.unmute", true)
        onToggled: function(value) { root.setPath("audio.unmute", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "restore the previous volume on exit"
        checked: root.boolAt("audio.restoreVolume", true)
        onToggled: function(value) { root.setPath("audio.restoreVolume", value) }
      }
    }

    // ---- camera -----------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "camera"
      summary: "light check"
      expanded: root.openSection === "camera"
      onToggled: root.openSection = root.openSection === "camera" ? "" : "camera"

      Toggle {
        width: parent.width
        theme: root.theme
        label: "camera steps enabled"
        hint: "the camera proves the room light is on; it never stores an image"
        checked: root.boolAt("camera.enabled", true)
        onToggled: function(value) { root.setPath("camera.enabled", value) }
      }

      LabeledField {
        width: parent.width
        theme: root.theme
        label: "device"
        placeholder: "/dev/video0"
        text: root.strAt("camera.device", "")
        onEdited: function(value) { root.setPath("camera.device", value) }
      }

      CameraPreview {
        id: cameraPreview
        width: parent.width
        theme: root.theme
        service: root.service
        device: root.strAt("camera.device", "")
        threshold: root.numAt("camera.lightThreshold", 60)
        cutoff: root.numAt("camera.nearBlackCutoff", 24)
        onThresholdPicked: function(value) { root.setPath("camera.lightThreshold", value) }
      }

      NumberField {
        width: parent.width
        theme: root.theme
        label: "light threshold"
        hint: "mean luma that counts as the light being on (16 = black, 235 = white)"
        value: root.numAt("camera.lightThreshold", 60)
        from: 0
        to: 235
        onModified: function(value) { root.setPath("camera.lightThreshold", value) }
      }

      NumberField {
        width: parent.width
        theme: root.theme
        label: "near-black cutoff"
        hint: "below this the camera counts as unusable and the step is skipped"
        value: root.numAt("camera.nearBlackCutoff", 24)
        from: 0
        to: 100
        onModified: function(value) { root.setPath("camera.nearBlackCutoff", value) }
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "auto-skip after failures"
        hint: "0 never auto-skips a camera step that keeps failing"
        value: root.numAt("camera.autoSkipAfterFailures", 3)
        from: 0
        to: 10
        onModified: function(value) { root.setPath("camera.autoSkipAfterFailures", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "warn when arming if the camera looks blocked"
        checked: root.boolAt("camera.warnOnArm", true)
        onToggled: function(value) { root.setPath("camera.warnOnArm", value) }
      }
    }

    // ---- lockdown ---------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "lockdown"
      summary: "what is blocked"
      expanded: root.openSection === "lockdown"
      onToggled: root.openSection = root.openSection === "lockdown" ? "" : "lockdown"

      Toggle {
        width: parent.width
        theme: root.theme
        label: "cover all monitors"
        checked: root.boolAt("lockdown.coverAllMonitors", true)
        onToggled: function(value) { root.setPath("lockdown.coverAllMonitors", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "exclusive keyboard focus"
        checked: root.boolAt("lockdown.exclusiveKeyboard", true)
        onToggled: function(value) { root.setPath("lockdown.exclusiveKeyboard", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "suppress notifications"
        checked: root.boolAt("lockdown.suppressNotifications", true)
        onToggled: function(value) { root.setPath("lockdown.suppressNotifications", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "pause other media"
        checked: root.boolAt("lockdown.pauseMedia", true)
        onToggled: function(value) { root.setPath("lockdown.pauseMedia", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "hide the bar"
        checked: root.boolAt("lockdown.hideBar", true)
        onToggled: function(value) { root.setPath("lockdown.hideBar", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "block window and workspace switching"
        checked: root.boolAt("lockdown.blockWindowSwitching", true)
        onToggled: function(value) { root.setPath("lockdown.blockWindowSwitching", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "suppress the idle screensaver and lock"
        checked: root.boolAt("lockdown.suppressIdle", true)
        onToggled: function(value) { root.setPath("lockdown.suppressIdle", value) }
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "maximum duration"
        hint: "in minutes; 0 means no cap at all"
        value: root.numAt("lockdown.maxDurationMinutes", 0)
        from: 0
        to: 1440
        zeroText: "off"
        onModified: function(value) { root.setPath("lockdown.maxDurationMinutes", value) }
      }
    }

    // ---- appearance -------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "appearance"
      summary: "colors and clock"
      expanded: root.openSection === "appearance"
      onToggled: root.openSection = root.openSection === "appearance" ? "" : "appearance"

      Choice {
        theme: root.theme
        options: [
          { value: "theme", label: "omarchy theme" },
          { value: "claude", label: "claude code" }
        ]
        value: root.strAt("ui.palette", "theme")
        onChosen: function(value) { root.setPath("ui.palette", String(value)) }
      }

      Card {
        width: parent.width
        height: Style.space(110)
        theme: root.theme

        SleepScreen {
          anchors.centerIn: parent
          theme: draftTheme
          now: Date.now()
          ringAt: 0
          sizeScale: 0.26
        }
      }

      LabeledField {
        width: parent.width
        theme: root.theme
        label: "font family"
        placeholder: "JetBrainsMono Nerd Font"
        text: root.strAt("ui.fontFamily", "")
        onEdited: function(value) { root.setPath("ui.fontFamily", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "24-hour clock"
        checked: root.boolAt("ui.clock24h", true)
        onToggled: function(value) { root.setPath("ui.clock24h", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "show seconds"
        checked: root.boolAt("ui.showSeconds", true)
        onToggled: function(value) { root.setPath("ui.showSeconds", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "show the ring time"
        checked: root.boolAt("ui.showRingTime", true)
        onToggled: function(value) { root.setPath("ui.showRingTime", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "show the countdown"
        checked: root.boolAt("ui.showCountdown", true)
        onToggled: function(value) { root.setPath("ui.showCountdown", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "show the date"
        checked: root.boolAt("ui.showDate", false)
        onToggled: function(value) { root.setPath("ui.showDate", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "pulse the border while the alarm rings"
        hint: "off by default: a slow pulse is nice, a strobe is not"
        checked: root.boolAt("ui.pulseOnRing", false)
        onToggled: function(value) { root.setPath("ui.pulseOnRing", value) }
      }

      SectionHeader {
        width: parent.width
        theme: root.theme
        text: "claude palette"
      }

      Repeater {
        model: Palette.TOKENS

        ColorField {
          id: colorRow
          required property var modelData

          width: parent.width
          theme: root.theme
          token: String(colorRow.modelData)
          value: root.strAt("ui.claudePalette." + String(colorRow.modelData), "")
          onColorEdited: function(token, value) { root.setPath("ui.claudePalette." + token, value) }
        }
      }

      Button {
        theme: root.theme
        text: "reset the claude palette"
        onClicked: {
          var preset = Palette.claudePreset()
          for (var key in preset) {
            if (preset.hasOwnProperty(key)) root.setPath("ui.claudePalette." + key, preset[key])
          }
        }
      }
    }

    // ---- safety -----------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "safety"
      summary: "emergency exit, watchdog"
      expanded: root.openSection === "safety"
      onToggled: root.openSection = root.openSection === "safety" ? "" : "safety"

      Toggle {
        width: parent.width
        theme: root.theme
        label: "emergency exit"
        hint: "hold esc for 3 seconds and type the phrase. off by default: the only exits are the finished challenges or the crash watchdog"
        checked: root.boolAt("safety.emergencyExit", false)
        onToggled: function(value) { root.setPath("safety.emergencyExit", value) }
      }

      Toggle {
        width: parent.width
        theme: root.theme
        label: "crash watchdog"
        hint: "restores the display and silences the alarm if the shell dies mid-sleep"
        checked: root.boolAt("safety.watchdog", true)
        onToggled: function(value) { root.setPath("safety.watchdog", value) }
      }
    }

    // ---- history ----------------------------------------------------------
    Section {
      width: parent.width
      theme: root.theme
      title: "history"
      summary: "recent sessions"
      expanded: root.openSection === "history"
      onToggled: root.openSection = root.openSection === "history" ? "" : "history"

      Text {
        width: parent.width
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: root.historyTotals
          ? root.historyTotals.sessions + " sessions  ·  "
            + Time.formatDuration(root.historyTotals.sleptMs) + " asleep  ·  "
            + root.historyTotals.earlyExits + " early exits"
          : ""
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Repeater {
        model: root.historyRecent

        Text {
          id: historyRow
          required property var modelData

          width: parent.width
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: {
            var record = historyRow.modelData
            if (!record) return ""
            var when = record.armedAt ? Time.formatDate(record.armedAt) + " " + Time.formatClock(record.armedAt, { h24: true, seconds: false }) : ""
            return when + "  ·  " + History.summary(record)
          }
          color: root.theme.faint
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }

    // ---- save -------------------------------------------------------------
    // Edits save themselves; this line says where they are.
    Text {
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: root.statusIsError ? root.statusText
        : (root.dirty ? "saving..." : "changes are saved automatically")
      color: root.statusIsError ? root.theme.error : root.theme.faint
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  Theme {
    id: draftTheme
    paletteOverride: root.draftPalette
    uiOverride: root.draft.ui ? root.draft.ui : ({})
  }

  Theme { id: fallbackTheme }
}
