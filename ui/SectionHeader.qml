import QtQuick
import qs.Commons

// Section label: an accent marker, a dim uppercase caption and a 1 px rule.
Item {
  id: root

  property var theme: fallbackTheme
  property string text: ""

  implicitWidth: row.implicitWidth
  implicitHeight: row.implicitHeight + Style.space(4)

  Row {
    id: row
    spacing: Style.space(8)

    Text {
      textFormat: Text.PlainText
      text: ">"
      color: root.theme.accent
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }

    Text {
      textFormat: Text.PlainText
      text: root.text.toUpperCase()
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      font.letterSpacing: Style.spaceReal(1)
    }
  }

  Rectangle {
    anchors.left: row.right
    anchors.leftMargin: Style.space(8)
    anchors.right: parent.right
    anchors.verticalCenter: row.verticalCenter
    height: 1
    color: root.theme.border
  }

  Theme { id: fallbackTheme }
}
