import QtQuick
import qs.Commons

// The Get The F Up button: monospace label in a 1 px QML-drawn border.
//   kind "normal" | "accent" | "danger" | "ghost"
Rectangle {
  id: root

  property var theme: fallbackTheme
  property string text: ""
  property string kind: "normal"
  property bool selected: false
  property bool compact: false
  property real fontSize: compact ? Style.font.caption : Style.font.bodySmall
  property string tooltip: ""
  // Held down, an autoRepeat button fires clicked() on press and then again
  // every repeatInterval ms; repeatCount says how many repeats so far.
  property bool autoRepeat: false
  property int repeatDelay: 400
  property int repeatInterval: 60
  property int repeatCount: 0

  readonly property bool hot: mouse.containsMouse
  readonly property color tone: kind === "accent" ? theme.accent
    : (kind === "danger" ? theme.error : theme.foreground)

  signal clicked()

  implicitWidth: label.implicitWidth + Style.space(compact ? 8 : 12) * 2
  implicitHeight: label.implicitHeight + Style.space(compact ? 3 : 6) * 2
  radius: Style.cornerRadius
  opacity: enabled ? 1 : 0.4
  color: {
    if (mouse.pressed) return theme.alpha(tone, 0.2)
    if (selected) return theme.alpha(theme.accent, 0.16)
    if (hot) return theme.alpha(tone, 0.09)
    return kind === "ghost" ? "transparent" : theme.alpha(tone, 0.03)
  }
  border.width: kind === "ghost" && !hot && !selected ? 0 : 1
  border.color: {
    if (selected) return theme.accent
    if (kind === "accent" || kind === "danger") return tone
    return hot ? theme.dim : theme.border
  }

  Behavior on color { ColorAnimation { duration: 90 } }

  Text {
    id: label
    anchors.centerIn: parent
    textFormat: Text.PlainText
    text: root.text
    color: root.selected ? root.theme.accent : root.tone
    font.family: root.theme.fontFamily
    font.pixelSize: root.fontSize
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    enabled: root.enabled
    acceptedButtons: Qt.LeftButton
    cursorShape: Qt.PointingHandCursor
    onClicked: if (!root.autoRepeat) root.clicked()
    onPressed: {
      if (!root.autoRepeat) return
      root.repeatCount = 0
      root.clicked()
      repeat.interval = root.repeatDelay
      repeat.restart()
    }
    onReleased: repeat.stop()
    onCanceled: repeat.stop()
  }

  Timer {
    id: repeat
    repeat: true
    onTriggered: {
      if (!root.enabled || !mouse.pressed) {
        repeat.stop()
        return
      }
      root.repeatCount += 1
      repeat.interval = root.repeatInterval
      root.clicked()
    }
  }

  onEnabledChanged: if (!root.enabled) repeat.stop()

  Theme { id: fallbackTheme }
}
