import QtQuick
import qs.Commons

// How close the room light is to the threshold, as a bar that fills while you
// switch the light on and turns green when it is bright enough. Once it is, a
// second thin bar fills while the light is held, because the step only passes
// after a moment of steady light.
//
//   progress  0..1  current light toward the threshold (full = reached)
//   hold      0..1  how long it has been held at or above the threshold
Item {
  id: root

  property var theme: fallbackTheme
  property real luma: -1
  property int threshold: 60
  property real progress: 0
  property real hold: 0
  // "unknown" | "dim" | "on" | "blocked"
  property string verdict: "unknown"
  // The light gate (the light must stay on to keep the challenge unlocked)
  // rather than a camera step.
  property bool gate: false
  property bool unlocked: false

  readonly property bool reached: root.progress >= 1
  readonly property color tone: root.reached ? root.theme.success : root.theme.accent

  function message() {
    if (root.gate) {
      if (root.unlocked) {
        return root.verdict === "on" ? "light on. keep it on to keep the challenge unlocked"
          : "the light dropped. bring it back or the challenge locks"
      }
      if (root.verdict === "blocked") return "the lens looks blocked. the challenge unlocks itself in a few seconds"
      if (root.verdict === "unknown") return "waiting for the camera..."
      return root.verdict === "on" ? "bright enough. hold it..." : "locked. switch the room light on to unlock the challenge"
    }
    switch (root.verdict) {
    case "on": return "bright enough. hold it..."
    case "dim": return "not bright enough yet. switch the room light on"
    case "blocked": return "the lens looks blocked. this step skips itself in a few seconds"
    default: return "waiting for the camera..."
    }
  }

  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(6)

    Row {
      width: parent.width

      Text {
        width: parent.width / 2
        textFormat: Text.PlainText
        text: root.gate ? (root.unlocked ? "light  ·  unlocked" : "light  ·  locked") : "light"
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Text {
        width: parent.width / 2
        horizontalAlignment: Text.AlignRight
        textFormat: Text.PlainText
        text: (root.luma >= 0 ? Math.round(root.luma) : "--") + " / " + root.threshold
          + "   " + Math.round(root.progress * 100) + "%"
        color: root.tone
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.bold: true
      }
    }

    Rectangle {
      width: parent.width
      height: Style.space(14)
      radius: Style.cornerRadius
      color: root.theme.alpha(root.theme.foreground, 0.05)
      border.width: 1
      border.color: root.reached ? root.theme.success : root.theme.border

      Rectangle {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.margins: 1
        width: Math.max(0, Math.round((parent.width - 2) * Math.max(0, Math.min(1, root.progress))))
        radius: Math.max(0, parent.radius - 1)
        color: root.tone
        Behavior on width { NumberAnimation { duration: 180; easing.type: Easing.OutQuad } }
      }
    }

    // Only meaningful once the light is bright enough.
    Rectangle {
      width: parent.width
      height: Style.space(4)
      radius: height / 2
      visible: root.reached
      color: root.theme.alpha(root.theme.foreground, 0.05)

      Rectangle {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Math.round(parent.width * Math.max(0, Math.min(1, root.hold)))
        radius: parent.radius
        color: root.theme.success
        Behavior on width { NumberAnimation { duration: 180 } }
      }
    }

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: root.message()
      color: root.verdict === "blocked" ? root.theme.error
        : (root.verdict === "on" ? root.theme.success : root.theme.dim)
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Theme { id: fallbackTheme }
}
