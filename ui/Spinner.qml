import QtQuick
import qs.Commons

// Integer stepper: "label            [-] 3 [+]".
Item {
  id: root

  property var theme: fallbackTheme
  property string label: ""
  property string hint: ""
  property string suffix: ""
  property int value: 0
  property int from: 0
  property int to: 100
  property int stepSize: 1
  property string zeroText: ""

  signal modified(int value)

  function bump(delta) {
    var next = Math.max(root.from, Math.min(root.to, root.value + delta))
    if (next !== root.value) root.modified(next)
  }

  implicitWidth: labelColumn.implicitWidth + controls.width + Style.space(12)
  implicitHeight: Math.max(labelColumn.implicitHeight, controls.height)
  opacity: enabled ? 1 : 0.45

  Column {
    id: labelColumn
    anchors.left: parent.left
    anchors.right: controls.left
    anchors.rightMargin: Style.space(12)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: root.label
      color: root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Text {
      width: parent.width
      visible: root.hint !== ""
      textFormat: Text.PlainText
      text: root.hint
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  Row {
    id: controls
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(6)

    Button {
      theme: root.theme
      compact: true
      text: "-"
      enabled: root.value > root.from
      onClicked: root.bump(-root.stepSize)
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      width: Math.max(implicitWidth, Style.space(52))
      horizontalAlignment: Text.AlignHCenter
      textFormat: Text.PlainText
      text: (root.value === 0 && root.zeroText !== "") ? root.zeroText : (root.value + root.suffix)
      color: root.theme.accent
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Button {
      theme: root.theme
      compact: true
      text: "+"
      enabled: root.value < root.to
      onClicked: root.bump(root.stepSize)
    }
  }

  Theme { id: fallbackTheme }
}
