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
// `open()` takes a JSON payload: { "view": "arm" | "settings" | "menu" }.
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

  readonly property var theme: panelTheme

  // ---- host contract -----------------------------------------------------
  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") || ({}) } catch (e) { payload = ({}) }
    var next = String(payload.view || root.view || "arm")
    if (next !== "arm" && next !== "settings" && next !== "menu") next = "arm"
  }


  function toggle() {
    if (root.opened) root.close()
    else root.open(JSON.stringify({ view: root.view }))
  }


  function cycleView(direction) {
    root.showView(root.view === "settings" ? "arm" : "settings")
  }

  function closeForPopoutSwitch() {
    root.popoutSwitchClosing = true
    root.close()
    Qt.callLater(function() { root.popoutSwitchClosing = false })
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
              text: "sleep mode"
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
            theme: root.theme
            service: root.service
            onCloseRequested: root.close()
            onArmed: root.close()
          }

          // ---- settings --------------------------------------------------
          Settings {
            id: settingsPanel
            width: parent.width
            visible: root.view === "settings"
            theme: root.theme
            service: root.service
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
