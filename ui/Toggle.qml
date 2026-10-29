import QtQuick
import qs.Commons

// Labeled checkbox row: "[x] label" with an optional dim hint underneath.
Item {
  id: root

  property var theme: fallbackTheme
  property string label: ""
  property string hint: ""
  property bool checked: false

  signal toggled(bool checked)

  implicitWidth: box.width + Style.space(10) + Math.max(labelText.implicitWidth, hintText.implicitWidth)
  implicitHeight: Math.max(box.height, textColumn.implicitHeight)
  opacity: enabled ? 1 : 0.45

  Rectangle {
    id: box
    anchors.left: parent.left
    y: Math.max(0, (labelText.implicitHeight - height) / 2)
    width: Style.space(14)
    height: width
    radius: Math.min(Style.cornerRadius, Style.space(3))
    color: "transparent"
    border.width: 1
    border.color: root.checked ? root.theme.accent : (mouse.containsMouse ? root.theme.dim : root.theme.border)

    Rectangle {
      anchors.centerIn: parent
      width: parent.width - Style.space(6)
      height: width
      radius: Math.max(0, parent.radius - 1)
      color: root.theme.accent
      visible: root.checked
    }
  }

  Column {
    id: textColumn
    anchors.left: box.right
    anchors.leftMargin: Style.space(10)
    anchors.right: parent.right
    spacing: Style.space(2)

    Text {
      id: labelText
      width: parent.width
      textFormat: Text.PlainText
      text: root.label
      color: root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Text {
      id: hintText
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

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    enabled: root.enabled
    cursorShape: Qt.PointingHandCursor
    onClicked: root.toggled(!root.checked)
  }

  Theme { id: fallbackTheme }
}
