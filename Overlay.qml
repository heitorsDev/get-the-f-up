pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import "ui"

// Fullscreen sleep screen, one PanelWindow per output (SPEC §3, §7).
//
// Host overlay contract: `opened`, `open(payloadJson)`, `close()`. The service
// summons it on arm / preview / dry run. While the mode is active
// (state armed or ringing) close() is refused, so the screen cannot be
// escaped by a stray hide.
//
// All interactive state (typed draft, flashes, emergency prompt) lives here,
// on the root, and every monitor renders it through an identical
// OverlayContent, so the challenge looks the same everywhere and only the
// focused output's surface holds the keyboard.
Item {
  id: root

  property string omarchyPath: ""
  property var shell: null
  property var manifest: null

  property bool opened: false
  property string mode: "sleep" // "sleep" | "preview"

  readonly property string pluginId: manifest && manifest.id ? String(manifest.id) : "io.github.heitorsdev.sleep-mode"

  // ---- service -------------------------------------------------------------
  property var service: null

  function lookupService() {
    if (root.service || !root.shell || typeof root.shell.serviceFor !== "function") return
    var found = root.shell.serviceFor(root.pluginId)
    if (found) root.service = found
  }

  onShellChanged: lookupService()
  onManifestChanged: lookupService()

  Timer {
    interval: 500
    repeat: true
    running: root.service === null && root.shell !== null
    onTriggered: root.lookupService()
  }

  Theme {
    id: theme
    service: root.service
  }

  // ---- derived state ---------------------------------------------------------
  readonly property string serviceState: root.service ? String(root.service.state || "idle") : "idle"
  readonly property bool active: serviceState === "armed" || serviceState === "ringing"
  readonly property bool ringing: serviceState === "ringing"
    || (previewing && root.service !== null && root.service.previewVariant === "ringing")
  readonly property bool previewing: !active
    && (mode === "preview" || (root.service !== null && root.service.previewing === true))
  readonly property bool dryRun: root.service !== null && root.service.dryRun === true
  readonly property var config: root.service && root.service.config ? root.service.config : ({})
  readonly property var lockdown: config.lockdown || ({})
  readonly property bool coverAllMonitors: lockdown.coverAllMonitors !== false
  readonly property bool exclusiveKeyboard: lockdown.exclusiveKeyboard !== false
  readonly property bool emergencyEnabled: !!(config.safety && config.safety.emergencyExit === true)
  readonly property var session: root.service ? root.service.session : null
  readonly property var challengeView: root.service && root.service.challenge ? root.service.challenge : null
  readonly property string cameraStatus: root.service ? String(root.service.cameraStatus || "idle") : "idle"
  // The camera step watches the light live (see Service.syncCameraWatch).
  readonly property real cameraLuma: root.service && root.service.cameraLuma !== undefined ? Number(root.service.cameraLuma) : -1
  readonly property real cameraProgress: root.service && root.service.cameraProgress !== undefined ? Number(root.service.cameraProgress) : 0
  readonly property real cameraHold: root.service && root.service.cameraHold !== undefined ? Number(root.service.cameraHold) : 0
  readonly property string cameraVerdict: root.service && root.service.cameraVerdict ? String(root.service.cameraVerdict) : "unknown"
  readonly property string cameraFrame: root.service && root.service.cameraFrame ? String(root.service.cameraFrame) : ""
  readonly property int cameraFrameSeq: root.service && root.service.cameraFrameSeq !== undefined ? Number(root.service.cameraFrameSeq) : 0
  readonly property string cameraError: root.service && root.service.cameraLiveError ? String(root.service.cameraLiveError) : ""
  // The optional light gate: the challenge is locked unless the light is on.
  readonly property bool lightGate: root.service !== null && root.service.lightGate === true
  readonly property bool lightLocked: root.service !== null && root.service.lightLocked === true
  readonly property bool lightUnlocked: root.service !== null && root.service.lightUnlocked === true
  readonly property string lightReleased: root.service && root.service.lightReleased ? String(root.service.lightReleased) : ""
  readonly property int lightThreshold: config.camera && config.camera.lightThreshold !== undefined ? Number(config.camera.lightThreshold) : 60
  readonly property var lastResult: root.service ? root.service.lastResult : null

  property real localNow: Date.now()
  readonly property real now: root.service && root.service.now ? Number(root.service.now) : localNow
  property real previewRingAt: 0
  readonly property real ringAt: previewing ? previewRingAt : (session && session.ringAt ? Number(session.ringAt) : 0)
  // The alarm preview pretends it started ringing a little while ago.
  property real previewRingingSince: 0
  readonly property real ringingSince: previewing ? previewRingingSince
    : (session && session.ringingSince ? Number(session.ringingSince) : 0)

  // The phrase the service expects for the emergency exit. The service may
  // publish its own via `emergencyPhrase`; otherwise this default is shown.
  readonly property string emergencyPhrase: root.service && root.service.emergencyPhrase
    ? String(root.service.emergencyPhrase) : "i am awake"

  Timer {
    interval: 1000
    repeat: true
    running: root.opened && !(root.service && root.service.now)
    onTriggered: root.localNow = Date.now()
  }

  // ---- shared interactive state -------------------------------------------
  property string focusedScreenName: ""
  property bool revealed: false
  property string draft: ""
  property bool wrongFlash: false
  property string outcomeText: ""
  property string outcomeKind: ""
  property bool memoryVisible: false
  property string memoryShownKey: ""
  property bool pendingCamera: false
  readonly property bool inputLocked: memoryVisible || lightLocked

  property bool escHolding: false
  property real escHoldProgress: 0
  property bool emergencyPrompt: false
  property string emergencyDraft: ""
  property string emergencyError: ""

  readonly property string currentType: challengeView && challengeView.type ? String(challengeView.type) : ""
  readonly property string challengeKey: {
    var v = root.challengeView
    if (!v) return ""
    var inst = v.instance || {}
    return [v.rep, v.stepIndex, v.completedSteps, v.type, inst.prompt || "", inst.expected || ""].join("|")
  }

  onChallengeKeyChanged: {
    root.draft = ""
    root.memoryVisible = false
    root.maybeFlashMemory()
  }

  // The service only watches the camera while the challenge is on screen: not
  // while the clock screen is up, and never in a preview.
  readonly property bool challengeShown: root.opened && root.revealed && root.active && !root.previewing
  onChallengeShownChanged: root.reportChallengeShown()
  onLightLockedChanged: if (!root.lightLocked) root.maybeFlashMemory()
  onServiceChanged: root.reportChallengeShown()

  function reportChallengeShown() {
    if (root.service && typeof root.service.setChallengeActive === "function") {
      root.service.setChallengeActive(root.challengeShown)
    }
  }

  onLastResultChanged: {
    var watching = root.service !== null && root.service.cameraWatching === true
    if ((!root.pendingCamera && !watching) || !root.lastResult) return
    root.pendingCamera = false
    var r = root.lastResult
    if (r.skipped) {
      var reason = String(r.reason || "")
      var why = reason.indexOf("block") >= 0 ? "lens blocked"
        : (reason.indexOf("demot") >= 0 ? "camera demoted after repeated failures"
        : (reason !== "" ? reason : "camera unavailable"))
      root.setOutcome("camera step skipped: " + why, "skip")
    } else if (r.correct) {
      root.setOutcome("light is on. step passed", "success")
    } else {
      root.flashWrong()
      root.setOutcome("too dark. turn the light on and capture again", "error")
    }
  }

  // The mode ended (solved, watchdog restore, emergency exit): take the
  // screen down even if the service forgets to hide us.
  onActiveChanged: {
    if (root.active && !root.opened) {
      root.open(JSON.stringify({ mode: "sleep" }))
    } else if (!root.active && root.opened && root.mode === "sleep") {
      root.forceClose()
    }
  }

  onPreviewingChanged: {
    if (root.previewing && !root.opened) root.open(JSON.stringify({ mode: "preview" }))
    else if (!root.previewing && root.opened && root.mode === "preview" && !root.active) root.forceClose()
  }

  // ---- host contract -------------------------------------------------------
  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") || ({}) } catch (e) { payload = ({}) }
    root.lookupService()
    var servicePreviewing = !root.active && root.service !== null && root.service.previewing === true
    root.mode = (payload.mode === "preview" || servicePreviewing) ? "preview" : "sleep"
    if (root.mode === "preview") root.previewRingAt = Date.now() + (6 * 60 + 15) * 60 * 1000
    if (root.mode === "preview") root.previewRingingSince = Date.now() - (3 * 60 + 12) * 1000
    // A sleep-mode open while idle would be an undismissable black screen.
    // Refuse it; onActiveChanged opens us as soon as the mode is armed.
    if (root.mode === "sleep" && !root.active) {
      if (root.opened) root.forceClose()
      return
    }
    root.captureFocusedScreen()
    root.resetInteraction()
    root.opened = true
  }

  function close() {
    if (root.active) {
      // Refused: the mode is active and the screen must stay up.
      root.opened = true
      return
    }
    root.forceClose()
  }

  function forceClose() {
    root.opened = false
    root.mode = "sleep"
    root.resetInteraction()
  }

  function dismissPreview() {
    if (!root.previewing) return
    if (root.service && typeof root.service.stopPreview === "function") root.service.stopPreview()
    else if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
    root.forceClose()
  }

  function captureFocusedScreen() {
    var screens = Quickshell.screens
    var focused = Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""
    var found = false
    for (var i = 0; i < screens.length; i++) {
      if (screens[i] && screens[i].name === focused) found = true
    }
    root.focusedScreenName = found ? focused : (screens.length > 0 && screens[0] ? String(screens[0].name) : "")
  }

  function resetInteraction() {
    root.revealed = false
    root.draft = ""
    root.wrongFlash = false
    root.outcomeText = ""
    root.outcomeKind = ""
    root.memoryVisible = false
    root.memoryShownKey = ""
    root.pendingCamera = false
    root.escHolding = false
    root.escHoldProgress = 0
    root.emergencyPrompt = false
    root.emergencyDraft = ""
    root.emergencyError = ""
    escHoldTimer.stop()
    wrongTimer.stop()
    outcomeTimer.stop()
    memoryTimer.stop()
    idleTimer.stop()
  }

  // ---- challenge actions ---------------------------------------------------
  function reveal() {
    if (root.previewing || !root.active) return
    root.revealed = true
    idleTimer.restart()
    root.maybeFlashMemory()
  }

  function maybeFlashMemory() {
    // A memory sequence is not flashed while the light gate holds the
    // challenge shut; it flashes when the light comes on.
    if (!root.revealed || root.lightLocked || root.currentType !== "memory" || root.memoryShownKey === root.challengeKey) return
    var inst = root.challengeView && root.challengeView.instance ? root.challengeView.instance : {}
    root.memoryShownKey = root.challengeKey
    root.memoryVisible = true
    memoryTimer.interval = Math.max(500, Number(inst.flashMs || 3000))
    memoryTimer.restart()
  }

  function flashWrong() {
    root.wrongFlash = true
    wrongTimer.restart()
  }

  function setOutcome(text, kind) {
    root.outcomeText = text
    root.outcomeKind = kind
    outcomeTimer.restart()
  }

  function submitDraft() {
    if (!root.service || root.inputLocked) return
    var input = root.draft
    if (input.trim() === "") return
    var result = root.service.submit(input)
    root.draft = ""
    if (!result || result.ok === false) {
      root.setOutcome(String((result && result.error) || root.service.lastError || "could not submit"), "error")
      return
    }
    if (result.correct) {
      root.setOutcome(result.finished ? "solved. good morning" : "step passed", "success")
    } else {
      root.flashWrong()
      if (root.currentType === "memory") {
        root.memoryShownKey = ""
        root.maybeFlashMemory()
      }
    }
  }

  function capture() {
    if (!root.service || root.cameraStatus === "capturing") return
    root.pendingCamera = true
    root.outcomeText = ""
    root.service.captureCamera()
  }

  function submitEmergency() {
    if (!root.service || typeof root.service.emergencyExit !== "function") return
    var result = root.service.emergencyExit(root.emergencyDraft)
    if (!result || !result.ok) {
      root.emergencyError = String((result && result.error) || root.service.lastError || "refused")
      root.emergencyDraft = ""
    } else {
      root.emergencyPrompt = false
      root.emergencyDraft = ""
    }
  }

  function pointerActivity() {
    if (root.previewing) { root.dismissPreview(); return }
    if (!root.active) { root.forceClose(); return }
    if (!root.revealed) root.reveal()
    else idleTimer.restart()
  }

  function isPrintable(event) {
    if (!event.text || event.text.length !== 1) return false
    if (event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) return false
    var code = event.text.charCodeAt(0)
    return code >= 32 && code !== 127
  }

  function handleKey(event) {
    event.accepted = true

    if (root.previewing) {
      if (event.key === Qt.Key_Escape) root.dismissPreview()
      return
    }
    if (!root.active) { root.forceClose(); return }

    var isEnter = event.key === Qt.Key_Return || event.key === Qt.Key_Enter

    if (event.key === Qt.Key_Escape) {
      if (root.emergencyPrompt) {
        if (!event.isAutoRepeat) {
          root.emergencyPrompt = false
          root.emergencyDraft = ""
          root.emergencyError = ""
        }
        return
      }
      if (!event.isAutoRepeat && root.emergencyEnabled) {
        root.escHolding = true
        root.escHoldProgress = 0
        escHoldTimer.restart()
      }
      return
    }

    if (root.emergencyPrompt) {
      if (isEnter) root.submitEmergency()
      else if (Util.editsFilter(event, root.emergencyDraft)) root.emergencyDraft = Util.editedFilter(event, root.emergencyDraft)
      else if (root.isPrintable(event) && root.emergencyDraft.length < 64) root.emergencyDraft += event.text
      return
    }

    idleTimer.restart()

    if (!root.revealed) {
      root.reveal()
      if (root.currentType !== "camera" && !root.inputLocked && root.isPrintable(event)) root.draft += event.text
      return
    }

    // The camera step has no input: it passes by itself when the light is on.
    if (root.currentType === "camera") return

    if (root.inputLocked) return

    if (Util.editsFilter(event, root.draft)) {
      root.draft = Util.editedFilter(event, root.draft)
    } else if (isEnter) {
      root.submitDraft()
    } else if (root.isPrintable(event) && root.draft.length < 64) {
      root.draft += event.text
    }
  }

  function handleKeyRelease(event) {
    if (event.key !== Qt.Key_Escape || event.isAutoRepeat) return
    var wasHolding = root.escHolding
    escHoldTimer.stop()
    root.escHolding = false
    root.escHoldProgress = 0
    if (root.previewing || !root.active || root.emergencyPrompt) return
    // A short Esc clears the draft, then steps back to the sleep screen.
    if (wasHolding || !root.emergencyEnabled) {
      if (root.draft !== "") root.draft = ""
      else root.revealed = false
    }
  }

  Timer {
    id: escHoldTimer
    interval: 50
    repeat: true
    property real startedAt: 0
    onRunningChanged: if (running) startedAt = Date.now()
    onTriggered: {
      root.escHoldProgress = Math.min(1, (Date.now() - startedAt) / 3000)
      if (root.escHoldProgress >= 1) {
        stop()
        root.escHolding = false
        root.escHoldProgress = 0
        root.emergencyPrompt = true
        root.emergencyDraft = ""
        root.emergencyError = ""
      }
    }
  }

  Timer {
    id: wrongTimer
    interval: 1200
    onTriggered: root.wrongFlash = false
  }

  Timer {
    id: outcomeTimer
    interval: 2600
    onTriggered: { root.outcomeText = ""; root.outcomeKind = "" }
  }

  Timer {
    id: memoryTimer
    interval: 3000
    onTriggered: root.memoryVisible = false
  }

  // Fall back to the sleep screen after a minute without input.
  Timer {
    id: idleTimer
    interval: 60000
    onTriggered: {
      // The camera step stays up: it has no typed draft, and hiding it would
      // close the camera while the light is being switched on.
      // While locked, the camera must stay open so the light can be seen.
      if (root.draft === "" && !root.emergencyPrompt && !root.memoryVisible
          && root.currentType !== "camera" && !root.lightLocked) root.revealed = false
      else restart()
    }
  }

  // ---- one surface per output ----------------------------------------------
  Variants {
    model: Quickshell.screens

    delegate: Component {
      PanelWindow {
        id: surface

        required property var modelData

        readonly property bool isFocusScreen: modelData && modelData.name === root.focusedScreenName

        screen: modelData
        visible: root.opened && (root.coverAllMonitors || isFocusScreen)
        color: theme.background
        exclusionMode: ExclusionMode.Ignore

        WlrLayershell.namespace: "omarchy-sleep-mode"
        WlrLayershell.layer: WlrLayer.Overlay
        // Preview never captures input; only the focused output's surface
        // ever takes the keyboard, exclusively only while the mode is active
        // and lockdown.exclusiveKeyboard is on.
        WlrLayershell.keyboardFocus: {
          if (!root.opened) return WlrKeyboardFocus.None
          if (root.previewing) return isFocusScreen ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.None
          if (root.exclusiveKeyboard) return isFocusScreen ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
          return WlrKeyboardFocus.OnDemand
        }

        anchors {
          top: true
          bottom: true
          left: true
          right: true
        }

        OverlayContent {
          anchors.fill: parent
          host: root
          theme: theme
          keyboardOwner: surface.isFocusScreen || !root.exclusiveKeyboard
          visible: surface.visible
        }
      }
    }
  }
}
