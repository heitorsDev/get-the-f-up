import QtQuick
import qs.Commons

// Everything drawn on one monitor's overlay surface. Every output gets an
// identical instance bound to the same `host` (Overlay.qml root), so the
// typed draft, flashes and progress mirror across monitors; keys only reach
// the surface that holds keyboard focus and are forwarded to `host`.
Item {
  id: root

  property var host: null
  property var theme: fallbackTheme
  property bool keyboardOwner: false

  readonly property bool previewing: host ? host.previewing === true : false
  readonly property bool ringing: host ? host.ringing === true : false
  readonly property bool revealed: host ? host.revealed === true : false
  readonly property var view: host ? host.challengeView : null
  readonly property bool showChallenge: revealed && !previewing && view !== null

  function grabKeys() {
    if (root.keyboardOwner) keyCatcher.forceActiveFocus()
  }

  onKeyboardOwnerChanged: Qt.callLater(root.grabKeys)
  onVisibleChanged: if (visible) Qt.callLater(root.grabKeys)
  Component.onCompleted: Qt.callLater(root.grabKeys)

  Rectangle {
    anchors.fill: parent
    color: root.theme.background
  }

  // Clicks: preview dismisses; the sleep screen reveals the challenge.
  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onClicked: if (root.host) root.host.pointerActivity()
  }

  // ---- sleep screen --------------------------------------------------------
  SleepScreen {
    id: bigScreen
    anchors.centerIn: parent
    theme: root.theme
    title: root.host ? root.host.ringTitle : ""
    maxWidth: root.width - Style.space(64)
    now: root.host ? root.host.now : Date.now()
    ringAt: root.host ? root.host.ringAt : 0
    ringing: root.ringing
    ringingSince: root.host ? root.host.ringingSince : 0
    opacity: root.showChallenge ? 0 : 1
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: 180 } }
  }

  // Compact clock above the challenge so the time stays visible.
  SleepScreen {
    anchors.top: parent.top
    anchors.topMargin: Style.space(48)
    anchors.horizontalCenter: parent.horizontalCenter
    theme: root.theme
    sizeScale: 0.4
    title: bigScreen.title
    maxWidth: bigScreen.maxWidth
    now: bigScreen.now
    ringAt: bigScreen.ringAt
    ringing: bigScreen.ringing
    ringingSince: bigScreen.ringingSince
    opacity: root.showChallenge ? 1 : 0
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: 180 } }
  }

  // ---- challenge ---------------------------------------------------------
  ChallengeView {
    anchors.centerIn: parent
    width: Math.min(parent.width - Style.space(64), Style.space(640))
    theme: root.theme
    host: root.host
    view: root.view
    cameraStatus: root.host ? root.host.cameraStatus : "idle"
    opacity: root.showChallenge ? 1 : 0
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: 180 } }
  }

  // Nothing to solve yet (service still loading, or the engine has no view).
  Text {
    anchors.centerIn: parent
    visible: root.revealed && !root.previewing && root.view === null
    textFormat: Text.PlainText
    text: "waiting for the challenge..."
    color: root.theme.dim
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.heading
  }

  // ---- emergency exit ----------------------------------------------------
  Card {
    anchors.centerIn: parent
    visible: root.host ? root.host.emergencyPrompt === true : false
    width: Math.min(parent.width - Style.space(64), Style.space(520))
    height: emergencyColumn.implicitHeight + Style.space(20) * 2
    theme: root.theme
    color: root.theme.background
    danger: true

    Column {
      id: emergencyColumn
      anchors.centerIn: parent
      width: parent.width - Style.space(20) * 2
      spacing: Style.space(10)

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "emergency exit"
        color: root.theme.error
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.heading
        font.bold: true
      }

      Text {
        width: parent.width
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: "type \"" + (root.host ? root.host.emergencyPhrase : "") + "\" and press enter. esc cancels."
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Card {
        width: parent.width
        height: emergencyText.implicitHeight + Style.space(8) * 2
        theme: root.theme
        highlighted: true

        Text {
          id: emergencyText
          anchors.left: parent.left
          anchors.leftMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: "> " + (root.host ? root.host.emergencyDraft : "") + "_"
          color: root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.title
        }
      }

      Text {
        width: parent.width
        visible: text !== ""
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: root.host ? root.host.emergencyError : ""
        color: root.theme.error
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  // Hold-Esc progress (only while the emergency exit is enabled and held).
  Rectangle {
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    height: Math.max(2, Style.space(2))
    width: parent.width * (root.host ? root.host.escHoldProgress : 0)
    visible: root.host ? root.host.escHolding === true : false
    color: root.theme.error
  }

  // ---- corners -----------------------------------------------------------
  Text {
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.margins: Style.space(24)
    visible: text !== ""
    textFormat: Text.PlainText
    text: {
      if (root.previewing) return "PREVIEW  ·  click or esc to close"
      if (root.host && root.host.dryRun) return "DRY RUN"
      return ""
    }
    color: root.theme.accent
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
    font.bold: true
  }

  Text {
    anchors.bottom: parent.bottom
    anchors.right: parent.right
    anchors.margins: Style.space(24)
    visible: root.view !== null && !root.previewing
    textFormat: Text.PlainText
    text: "errors " + (root.view ? Number(root.view.errors || 0) : 0)
    color: root.view && Number(root.view.errors || 0) > 0 ? root.theme.dim : root.theme.faint
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.caption
  }

  Text {
    anchors.bottom: parent.bottom
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottomMargin: Style.space(24)
    visible: !root.revealed && !root.previewing
    textFormat: Text.PlainText
    text: "press any key to solve the challenge"
    color: root.theme.faint
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.caption
  }

  // ---- ring pulse (ui.pulseOnRing, default off) ----------------------------
  Rectangle {
    id: pulse
    anchors.fill: parent
    visible: root.ringing && root.theme.ui.pulseOnRing === true
    color: "transparent"
    radius: Style.cornerRadius
    border.width: Style.space(6)
    border.color: root.theme.error
    opacity: 0.15

    SequentialAnimation on opacity {
      running: pulse.visible
      loops: Animation.Infinite
      NumberAnimation { from: 0.15; to: 1; duration: 1000; easing.type: Easing.InOutSine }
      NumberAnimation { from: 1; to: 0.15; duration: 1000; easing.type: Easing.InOutSine }
    }
  }

  // ---- keyboard ------------------------------------------------------------
  Item {
    id: keyCatcher
    anchors.fill: parent
    focus: root.keyboardOwner
    Keys.priority: Keys.BeforeItem
    Keys.onPressed: function(event) {
      if (root.host) root.host.handleKey(event)
      else event.accepted = true
    }
    Keys.onReleased: function(event) {
      if (root.host) root.host.handleKeyRelease(event)
      event.accepted = true
    }
  }

  Theme { id: fallbackTheme }
}
