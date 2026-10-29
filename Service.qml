import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons

import "Challenge.js" as Challenge
import "Config.js" as Config
import "History.js" as History
import "Lockdown.js" as Lockdown
import "Palette.js" as Palette
import "Steps.js" as Steps
import "Time.js" as Time

// The Sleep Mode service (SPEC.md §2).
//
// Owns the state machine (idle / armed / ringing), the one-second clock, the
// challenge engine and every side effect: display dimming, the alarm, the
// camera check, the lockdown toggles, the crash watchdog and the CLI IPC
// target.
//
// The JS modules stay pure — they only build commands and parse output. Every
// command that touches the machine is run through a Quickshell Process.
Item {
  id: root

  // ---- host injection -------------------------------------------------------
  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string pluginId: manifest && manifest.id
    ? String(manifest.id) : "io.github.heitorsdev.sleep-mode"
  readonly property string home: Quickshell.env("HOME")
  // The plugin's own directory, resolved from this file's URL. Used to find
  // bin/sleep-mode-restore, bin/sleep-mode-watchdog and assets/.
  readonly property string pluginDir: Lockdown.urlToPath(Qt.resolvedUrl("."))
  readonly property string configPath: Config.configPath(home)
  readonly property string historyPath: Config.historyPath(home)
  readonly property string activePath: Config.activePath(home)
  readonly property string emergencyPhrase: Lockdown.EMERGENCY_PHRASE

  // ---- live state (the UI contract, docs/contracts.md) ----------------------
  readonly property string state: _state
  property string _state: "idle"
  property bool previewing: false
  property bool dryRun: false
  property real now: 0
  property var config: Config.defaults()
  property var palette: Palette.resolve(config.ui, themeSnapshot)
  property var session: null
  property var challenge: null
  property string cameraPrecheck: "unknown"
  property string cameraStatus: "idle"
  property var lastResult: null
  property var historyList: []
  property string lastError: ""

  // The challenge engine state (Challenge.create) and the resolved preset.
  property var _engine: null
  property var _resolved: null
  property string _exitReason: ""

  signal ringing()
  signal finished(var record)

  // The live Omarchy theme, in the shape Palette.fromTheme expects.
  readonly property var themeSnapshot: ({
    background: Color.background,
    foreground: Color.foreground,
    muted: Color.muted,
    accent: Color.accent,
    urgent: Color.urgent,
    popups: ({ border: Color.popups.border }),
    menu: ({ border: Color.menu.border })
  })

  // ---- the clock ------------------------------------------------------------
  Timer {
    id: tickTimer
    interval: 1000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: root.tick()
  }

  // ---- configuration and history -------------------------------------------
  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfigText(text())
    onLoadFailed: root.config = Config.defaults()
    onFileChanged: configFile.reload()
  }

  FileView {
    id: historyFile
    path: root.historyPath
    watchChanges: true
    printErrors: false
    onLoaded: root.historyList = History.parse(text())
    onLoadFailed: root.historyList = []
    onFileChanged: historyFile.reload()
  }

  // ---- the one-shot command runner -----------------------------------------
  // A single Process runs every short-lived command in order. Each step is
  // { cmd: [argv], done: function(exitCode, output) }.
  property var _queue: []
  property var _current: null
  property bool _stepStarted: false
  property int _outMark: 0
  property int _errMark: 0

  Process {
    id: runner
    stdout: StdioCollector { id: runnerOut }
    stderr: StdioCollector { id: runnerErr }

    onStarted: root._stepStarted = true
    onExited: function(exitCode, exitStatus) {
      root.finishStep(exitCode,
        runnerOut.text.substring(root._outMark) + runnerErr.text.substring(root._errMark))
    }
    onRunningChanged: {
      // A command that cannot even start never emits `exited`; treat it as a
      // failed step so the queue keeps moving.
      if (runner.running) {
        root._stepStarted = true
      } else if (root._current !== null && !root._stepStarted) {
        root.finishStep(127, "")
      }
    }
  }

  function enqueue(steps) {
    if (!steps) return
    for (var i = 0; i < steps.length; i++) root._queue.push(steps[i])
    root.pump()
  }

  function run(command, done) {
    root.enqueue([{ cmd: command, done: done }])
  }

  function pump() {
    if (root._current !== null) return
    if (root._queue.length === 0) return
    root._current = root._queue.shift()
    root._stepStarted = false
    root._outMark = runnerOut.text.length
    root._errMark = runnerErr.text.length
    runner.command = root._current.cmd
    runner.running = true
  }

  function finishStep(exitCode, output) {
    var step = root._current
    root._current = null
    if (step && step.done) {
      try {
        step.done(exitCode, output)
      } catch (e) {
        console.warn("sleep-mode: step failed: " + e)
      }
    }
    root.pump()
  }

  // ---- result helpers -------------------------------------------------------
  function ok(extra) {
    root.lastError = ""
    var out = { ok: true }
    if (extra) {
      for (var key in extra) out[key] = extra[key]
    }
    return out
  }

  function fail(message) {
    root.lastError = String(message || "unknown error")
    return { ok: false, error: root.lastError }
  }

  // ---- the clock ------------------------------------------------------------
  function tick() {
    var t = Date.now()
    root.now = t
    if (root.state === "armed" && root.session && t >= Number(root.session.ringAt)) {
      root.enterRinging(t)
      return
    }
    if (root.state !== "idle" && root.session) {
      if (Lockdown.maxDurationReached(root.config.lockdown, root.session.armedAt, t)) {
        root.exitSession("the maximum duration was reached")
      }
    }
  }

  // ---- configuration --------------------------------------------------------
  function applyConfigText(raw) {
    var parsed = Config.parse(raw)
    root.config = parsed.config
    if (parsed.error) root.lastError = parsed.error
  }

  function saveConfig(config) {
    var merged = Config.merge(config)
    root.config = merged
    root.run(Lockdown.writeFileCommand(root.configPath, Config.serialize(merged)), function() {
      console.log("sleep-mode: config written")
    })
    return root.ok()
  }

  function reloadConfig() {
    configFile.reload()
    return root.ok()
  }

  // ---- the overlay ----------------------------------------------------------
  function openOverlay(mode) {
    if (!root.shell || typeof root.shell.summon !== "function") {
      return root.fail("the shell is not available")
    }
    var payload = JSON.stringify({ mode: mode === "preview" ? "preview" : "sleep" })
    if (root.shell.summon(root.pluginId, payload) !== true) {
      return root.fail("could not open the overlay")
    }
    return root.ok()
  }

  function startPreview() {
    if (root.state !== "idle") return root.fail("sleep mode is already active")
    root.previewing = true
    root.openOverlay("preview")
    return root.ok()
  }

  function stopPreview() {
    root.previewing = false
    if (root.state === "idle" && root.shell && typeof root.shell.hide === "function") {
      root.shell.hide(root.pluginId)
    }
    return root.ok()
  }

  // ---- arming ---------------------------------------------------------------
  function arm(payload) {
    return root.beginSession(payload, false)
  }

  function startDryRun(payload) {
    return root.beginSession(payload, true)
  }

  function beginSession(payload, dry) {
    if (root.state !== "idle") return root.fail("sleep mode is already active")
    if (root.previewing) root.stopPreview()

    var request = payload || {}
    var when = { ringAt: 0, error: "" }
    if (dry === true) {
      // A dry run always rings after ten seconds, whatever the payload says.
      when.ringAt = Date.now() + 10000
    } else {
      when = Time.parseWhen(request, Date.now())
      if (when.error) return root.fail(when.error)
    }

    var presetName = request.challenge === undefined || request.challenge === null
      || request.challenge === "" ? "default" : String(request.challenge)
    var resolved = Challenge.resolvePreset(root.config, presetName)
    if (!resolved) return root.fail("unknown challenge preset \"" + presetName + "\"")
    if (request.removeCamera === true) resolved = Challenge.removeCameraSteps(resolved)

    var reps = request.reps === undefined || request.reps === null
      ? Number(root.config.challenge.reps)
      : Number(request.reps)
    reps = Math.max(1, Math.floor(reps || 1))

    var armedAt = Date.now()
    root.dryRun = dry === true
    root._resolved = resolved
    root._engine = Challenge.create(resolved, reps)
    root.session = {
      armedAt: armedAt,
      ringAt: when.ringAt,
      ringingSince: 0,
      preset: resolved.name,
      reps: reps,
      dryRun: dry === true
    }
    root.challenge = Challenge.view(root._engine)
    root._state = "armed"
    root.setupSession()
    return root.ok()
  }

  // Everything that touches the machine happens after the pre-state capture.
  function setupSession() {
    root.afterCapture()
  }

  function afterCapture() {
    root.openOverlay("sleep")
  }

  // ---- the ring -------------------------------------------------------------
  function enterRinging(at) {
    if (root.state !== "armed" || !root.session) return
    if (root.session.ringingSince) return
    root.session.ringingSince = at
    root._state = "ringing"
    root.ringing()
    root.startAlarm()
  }

  function startAlarm() {
    // Filled in by the audio stage.
  }

  // ---- the challenge --------------------------------------------------------
  function submit(input) {
    if (root.state === "idle") return root.fail("sleep mode is not active")
    if (!root._engine) return root.fail("no challenge is running")
    if (root._engine.current && root._engine.current.type === "camera") {
      return root.fail("this is a camera step: capture a frame")
    }
    var text = input === undefined || input === null ? "" : String(input)
    var result = Challenge.submit(root._engine, text)
    root._engine = result.state
    root.challenge = Challenge.view(root._engine)
    var correct = result.correct === true
    root.lastResult = {
      correct: correct,
      skipped: false,
      reason: correct ? "ok" : "wrong",
      at: Date.now()
    }
    var done = !!(root._engine && root._engine.done)
    if (done) root.exitSession("the challenge was solved")
    return root.ok({ correct: correct, finished: done })
  }

  function emergencyExit(confirmation) {
    if (!root.config.safety || root.config.safety.emergencyExit !== true) {
      return root.fail("the emergency exit is disabled")
    }
    if (!Lockdown.emergencyAccepted(root.config.safety, confirmation)) {
      return root.fail("wrong confirmation phrase")
    }
    root.exitSession("the emergency exit was used")
    return root.ok()
  }

  // ---- leaving --------------------------------------------------------------
  function exitSession(reason) {
    if (root.state === "idle") return
    var exitAt = Date.now()
    var record = null
    if (!root.dryRun) record = History.makeRecord(root.session, exitAt, root._engine)

    root._exitReason = String(reason || "")
    root._state = "idle"
    root.dryRun = false
    root.session = null
    root.challenge = null
    root._engine = null
    root._resolved = null

    root.finishSession(record)
  }

  function finishSession(record) {
    if (record) root.finished(record)
  }

  // ---- status for the CLI ---------------------------------------------------
  function statusJson() {
    var out = {
      state: root.state,
      previewing: root.previewing,
      dryRun: root.dryRun,
      now: Math.round(root.now),
      ringAt: root.session ? Number(root.session.ringAt) : 0,
      remaining: root.session ? Math.max(0, Number(root.session.ringAt) - root.now) : 0,
      preset: root.session ? String(root.session.preset) : "",
      reps: root.session ? Number(root.session.reps) : 0,
      cameraPrecheck: root.cameraPrecheck,
      cameraStatus: root.cameraStatus,
      lastError: root.lastError,
      steps: []
    }
    if (root._resolved && root._resolved.steps) {
      for (var i = 0; i < root._resolved.steps.length; i++) {
        var spec = root._resolved.steps[i]
        out.steps.push({ type: String(spec.type || ""), description: Steps.describe(spec) })
      }
    }
    if (root.challenge) {
      out.progress = {
        rep: Number(root.challenge.rep || 0),
        reps: Number(root.challenge.reps || 0),
        stepIndex: Number(root.challenge.stepIndex || 0),
        stepCount: Number(root.challenge.stepCount || 0),
        completedSteps: Number(root.challenge.completedSteps || 0),
        totalSteps: Number(root.challenge.totalSteps || 0),
        errors: Number(root.challenge.errors || 0),
        done: root.challenge.done === true
      }
    } else {
      out.progress = null
    }
    return out
  }

  Component.onCompleted: {
    root.now = Date.now()
    configFile.reload()
    historyFile.reload()
  }
}
