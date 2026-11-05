pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui as HostUi
import "ui"

// The popout container.
//
// The plugin declares no "panel" kind — declaring one would turn the whole
// plugin into a panel — so the arming dialog, the settings and the bar's
// right-click menu are popouts owned by the bar widget. This is the pattern
// io.github.jcarcinogen.rice-bar uses with RicePanel.qml.
//
// Host panel contract: `opened` (bool), `open(payloadJson)`, `close()`.
//
// `open()` takes a JSON payload: { "view": "arm" | "alarms" | "settings" | "menu" }.
Item {
  id: root

  property var bar: null
  property var settings: ({})
  property var anchorItem: null
  property var hostWidget: null
  property var service: null

  property bool opened: false
  property string view: "arm"
  property bool popoutSwitching: false
  property bool popoutSwitchClosing: false

  // The explicit confirm gate in front of the two test modes (SPEC §10).
  property bool confirmOpen: false
  property string confirmTitle: ""
  property string confirmMessage: ""
  property string confirmAction: ""

  readonly property var theme: panelTheme

  readonly property var menuEntries: [
    { key: "alarms", label: "Day alarms", hint: "alarms that skip the sleep screen" },
    { key: "settings", label: "Settings", hint: "presets, display, palette" },
    { key: "preview_armed", label: "Preview idle screen", hint: "no side effects" },
    { key: "preview_ringing", label: "Preview alarm screen", hint: "no side effects" },
    { key: "dryrun", label: "Dry run", hint: "dims and plays the alarm" }
  ]

  // ---- host contract -----------------------------------------------------
  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") || ({}) } catch (e) { payload = ({}) }
    var next = String(payload.view || root.view || "arm")
    if (next !== "arm" && next !== "alarms" && next !== "settings" && next !== "menu") next = "arm"
    root.view = next
    root.confirmOpen = false
    root.opened = true
  }

  function close() {
    root.confirmOpen = false
    root.opened = false
    settingsPanel.flush()
    // Never leave the camera open behind a closed panel.
    if (root.service) root.service.stopCameraLive()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open(JSON.stringify({ view: root.view }))
  }

  function showView(next) {
    root.view = next
    root.confirmOpen = false
  }

  readonly property var cycleOrder: ["arm", "alarms", "settings"]

  function cycleView(direction) {
    var i = root.cycleOrder.indexOf(root.view)
    var step = direction < 0 ? -1 : 1
    var n = root.cycleOrder.length
    root.showView(root.cycleOrder[((i < 0 ? 0 : i + step) % n + n) % n])
  }

  function closeForPopoutSwitch() {
    root.popoutSwitchClosing = true
    root.close()
    Qt.callLater(function() { root.popoutSwitchClosing = false })
  }

  // ---- menu actions ------------------------------------------------------
  function handleMenu(key) {
    if (key === "settings" || key === "alarms") {
      root.showView(key)
      return
    }
    // A preview changes nothing (no dim, no sound, no lock, no camera), so it
    // needs no confirmation.
    if (key === "preview_armed" || key === "preview_ringing") {
      root.runPreview(key === "preview_ringing" ? "ringing" : "armed")
      return
    }
    if (key === "dryrun") {
      root.askConfirm("dryrun", "Dry run",
        "A dry run dims the display, plays the alarm at full volume and rings in 10 seconds. The screen and the audio come back afterwards, and no history entry is written.")
      return
    }
  }

  function runPreview(variant, title) {
    if (root.service && typeof root.service.startPreview === "function") root.service.startPreview(variant, title || "")
    root.close()
  }

  function askDryRun() {
    root.askConfirm("dryrun", "Dry run",
      "A dry run dims the display, plays the alarm at full volume and rings in 10 seconds. The screen and the audio come back afterwards, and no history entry is written.")
  }

  function askConfirm(action, title, message) {
    root.confirmAction = action
    root.confirmTitle = title
    root.confirmMessage = message
    root.confirmOpen = true
  }

  function runConfirmed() {
    var action = root.confirmAction
    root.confirmOpen = false
    if (!root.service) return
    if (action === "preview") {
      if (typeof root.service.startPreview === "function") root.service.startPreview()
      root.close()
    } else if (action === "dryrun") {
      if (typeof root.service.startDryRun === "function") root.service.startDryRun(root.dryRunPayload())
      root.close()
    }
  }

  function dryRunPayload() {
    var cfg = root.service && root.service.config ? root.service.config : ({})
    var challenge = cfg.challenge ? cfg.challenge : ({})
    var name = challenge.defaultPreset ? String(challenge.defaultPreset) : "standard"
    return { duration: "10s", challenge: name, reps: 1 }
  }

  // ---- the popout --------------------------------------------------------
  HostUi.KeyboardPanel {
    id: keyboardPanel
    anchorItem: root.anchorItem
    owner: root.hostWidget ? root.hostWidget : root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: keyboardPanel.fittedContentWidth(Style.space(440), Style.space(560))
    contentHeight: keyboardPanel.fittedContentHeight(body.implicitHeight, Style.space(720))

    HostUi.PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.cycleView(direction) }

      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: body.implicitHeight
        clip: true
        interactive: contentHeight > height
        boundsBehavior: Flickable.StopAtBounds

        Column {
          id: body
          width: parent.width
          spacing: Style.space(12)

          // ---- header ---------------------------------------------------
          Item {
            id: header
            width: parent.width
            height: Style.space(30)

            Text {
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: "get the f up"
              color: root.theme.accent
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.bold: true
              font.letterSpacing: Style.spaceReal(1)
            }

            Row {
              id: headerActions
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              Button {
                theme: root.theme
                compact: true
                text: "arm"
                selected: root.view === "arm"
                onClicked: root.showView("arm")
              }

              Button {
                theme: root.theme
                compact: true
                text: "alarms"
                selected: root.view === "alarms"
                onClicked: root.showView("alarms")
              }

              Button {
                theme: root.theme
                compact: true
                text: "settings"
                selected: root.view === "settings"
                onClicked: root.showView("settings")
              }
            }
          }

          // ---- arming ----------------------------------------------------
          Dialog {
            id: armDialog
            width: parent.width
            visible: root.view === "arm"
            active: root.opened && root.view === "arm"
            theme: root.theme
            service: root.service
            onCloseRequested: root.close()
            onArmed: root.close()
            // The alarm preview shows the title being typed.
            onPreviewRequested: function(variant) { root.runPreview(variant, armDialog.title) }
            onDryRunRequested: root.askDryRun()
          }

          // ---- day alarms ------------------------------------------------
          AlarmList {
            width: parent.width
            visible: root.view === "alarms"
            theme: root.theme
            service: root.service
          }

          // ---- settings --------------------------------------------------
          Settings {
            id: settingsPanel
            width: parent.width
            visible: root.view === "settings"
            theme: root.theme
            service: root.service
            onPreviewRequested: function(variant) { root.runPreview(variant) }
            onDryRunRequested: root.askDryRun()
          }

          // ---- menu ------------------------------------------------------
          Menu {
            id: menu
            width: parent.width
            visible: root.view === "menu"
            theme: root.theme
            entries: root.menuEntries
            onChosen: function(key) { root.handleMenu(key) }
          }
        }
      }

      // ---- explicit confirm -----------------------------------------------
      Rectangle {
        id: confirmScrim
        anchors.fill: parent
        visible: root.confirmOpen
        color: root.theme.alpha(root.theme.background, 0.88)

        MouseArea {
          anchors.fill: parent
          onClicked: {}
        }

        Card {
          id: confirmCard
          anchors.centerIn: parent
          width: Math.max(Style.space(220), confirmScrim.width - Style.space(40))
          height: confirmColumn.implicitHeight + Style.space(20) * 2
          theme: root.theme
          color: root.theme.background

          Column {
            id: confirmColumn
            anchors.centerIn: parent
            width: parent.width - Style.space(20) * 2
            spacing: Style.space(10)

            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
              text: root.confirmTitle
              color: root.theme.foreground
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
            }

            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
              text: root.confirmMessage
              color: root.theme.dim
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.bodySmall
            }

            Row {
              width: parent.width
              spacing: Style.space(8)

              Button {
                theme: root.theme
                text: "cancel"
                onClicked: root.confirmOpen = false
              }

              Button {
                theme: root.theme
                kind: "danger"
                text: root.confirmAction === "dryrun" ? "run the dry run" : "show the preview"
                onClicked: root.runConfirmed()
              }
            }
          }
        }
      }
    }
  }

  Theme {
    id: panelTheme
    service: root.service
  }
}
