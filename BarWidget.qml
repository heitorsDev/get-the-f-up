pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui as HostUi
import "ui"
import "Time.js" as Time

// The bar slot (SPEC §8).
//
// The widget owns no state: it renders what the service reports and forwards
// clicks to it. The service can be missing for a moment at startup, so the
// lookup is retried until the service shows up.
//
//   idle     icon only               left click: the arming popout
//   armed    icon + compact countdown left click: the sleep screen
//   ringing  error colour, pulsing    left click: the sleep screen
//
// Right click in any state opens the menu: Settings · Preview · Dry run.
//
HostUi.BarWidget {
  id: root
  moduleName: "io.github.heitorsdev.get-the-f-up"

  readonly property string pluginId: "io.github.heitorsdev.get-the-f-up"

  // ---- service -----------------------------------------------------------
  // The service is reached through the host's shell facade. For a third-party
  // bar widget the facade hangs off `bar.shell`; `shell` is kept as a
  // fallback for hosts that inject it on the entry point itself.
  property var service: null
  property var shell: null

  readonly property var shellFacade: bar && bar.shell ? bar.shell : root.shell

  function lookupService() {
    if (root.service) return
    var facade = root.shellFacade
    if (!facade || typeof facade.serviceFor !== "function") return
    var found = facade.serviceFor(root.pluginId)
    if (found) root.service = found
  }

  onBarChanged: root.lookupService()
  onShellChanged: root.lookupService()
  onServiceChanged: root.injectPanel()
  Component.onCompleted: root.lookupService()

  Timer {
    interval: 500
    repeat: true
    running: root.service === null
    onTriggered: root.lookupService()
  }

  // ---- state -------------------------------------------------------------
  readonly property string serviceState: root.service ? String(root.service.state || "idle") : "idle"
  readonly property bool armed: root.serviceState === "armed"
  readonly property bool ringing: root.serviceState === "ringing"
  readonly property var session: root.service ? root.service.session : null
  readonly property var config: root.service && root.service.config ? root.service.config : ({})

  property real localNow: Date.now()
  readonly property real now: root.service && root.service.now ? Number(root.service.now) : root.localNow

  Timer {
    interval: 1000
    repeat: true
    running: root.service === null
    onTriggered: root.localNow = Date.now()
  }

  readonly property real ringAt: root.session && root.session.ringAt ? Number(root.session.ringAt) : 0
  readonly property real ringingSince: root.session && root.session.ringingSince ? Number(root.session.ringingSince) : 0
  readonly property string presetName: root.session && root.session.preset ? String(root.session.preset) : ""
  readonly property bool clock24h: !(root.config.ui && root.config.ui.clock24h === false)

  readonly property string countdownText: root.armed && root.ringAt > 0
    ? Time.formatCompact(Math.max(0, root.ringAt - root.now)) : ""

  readonly property color iconColor: root.ringing
    ? barTheme.error
    : (root.armed
      ? barTheme.accent
      : (root.bar ? root.bar.barForeground : Color.foreground))

  readonly property var nextAlarm: root.service ? root.service.nextAlarm : null
  readonly property string sessionTitle: root.session && root.session.title ? String(root.session.title) : ""

  readonly property string tooltipText: {
    if (!root.armed && !root.ringing) {
      if (!root.nextAlarm) return "Get The F Up"
      var a = root.nextAlarm.alarm
      var title = a && a.title ? String(a.title) : "alarm"
      return "Get The F Up  ·  next alarm: " + title + " at "
        + Time.formatClock(root.nextAlarm.at, { h24: root.clock24h, seconds: false })
    }
    var parts = []
    if (root.sessionTitle !== "") parts.push(root.sessionTitle)
    if (root.ringAt > 0) parts.push("rings at " + Time.formatClock(root.ringAt, { h24: root.clock24h, seconds: false }))
    if (root.armed && root.ringAt > 0) {
      parts.push("in " + Time.formatCompact(Math.max(0, root.ringAt - root.now)))
    } else if (root.ringing && root.ringingSince > 0) {
      parts.push(Time.formatElapsed(Math.max(0, root.now - root.ringingSince)))
    }
    if (root.presetName !== "") parts.push(root.presetName)
    if (parts.length === 0) return "Get The F Up"
    return parts.join("  ·  ")
  }

  // ---- the popout --------------------------------------------------------
  readonly property var panel: panelLoader.item

  readonly property bool opened: root.panel ? root.panel.opened === true : false
  readonly property bool popoutSwitchClosing: root.panel ? root.panel.popoutSwitchClosing === true : false

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = iconButton
    if ("hostWidget" in target) target.hostWidget = root
    if ("service" in target) target.service = root.service
  }

  function open() { root.openPanel("arm") }
  function close() { if (root.panel) root.panel.close() }
  function togglePanel() { root.opened ? root.close() : root.open() }
  function closeForPopoutSwitch() { if (root.panel) root.panel.closeForPopoutSwitch() }

  function openPanel(view) {
    if (!root.panel) return
    root.panel.open(JSON.stringify({ view: view }))
  }

  // ---- clicks ------------------------------------------------------------
  function handlePress(mouseButton) {
    if (mouseButton === Qt.RightButton) {
      root.openPanel("menu")
      return
    }
    if (mouseButton === Qt.MiddleButton) return
    if (root.armed || root.ringing) {
      if (root.service && typeof root.service.openOverlay === "function") root.service.openOverlay()
      return
    }
    root.openPanel("arm")
  }

  // ---- layout ------------------------------------------------------------
  implicitWidth: iconHolder.width
    + (countdownText.visible ? Style.space(6) + countdownText.implicitWidth : 0)
  implicitHeight: iconHolder.height

  Item {
    id: iconHolder
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: iconButton.width
    height: iconButton.height

    // The ring state pulses the icon so it reads at a glance from across
    // the room. The animation drives a plain property so the resting
    // opacity is always exactly 1 when the alarm is not ringing.
    property real pulseValue: 1

    opacity: root.ringing ? pulseValue : 1

    SequentialAnimation on pulseValue {
      running: root.ringing
      loops: Animation.Infinite
      NumberAnimation { from: 1; to: 0.3; duration: 700; easing.type: Easing.InOutSine }
      NumberAnimation { from: 0.3; to: 1; duration: 700; easing.type: Easing.InOutSine }
    }

    HostUi.BarIconButton {
      id: iconButton
      width: implicitWidth
      height: implicitHeight
      bar: root.bar
      text: "󰒲"
      foreground: root.iconColor
      tooltipText: root.tooltipText
      onPressed: function(mouseButton) { root.handlePress(mouseButton) }
    }
  }

  Text {
    id: countdownText
    anchors.left: iconHolder.right
    anchors.leftMargin: Style.space(6)
    anchors.verticalCenter: iconHolder.verticalCenter
    visible: root.armed && root.countdownText !== "" && !root.vertical
    textFormat: Text.PlainText
    text: root.countdownText
    color: barTheme.accent
    font.family: barTheme.fontFamily
    font.pixelSize: Style.font.bodySmall
    font.features: { "tnum": 1 }
  }

  Theme {
    id: barTheme
    service: root.service
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }
}
