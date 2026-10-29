import QtQuick
import qs.Commons

// A collapsible section: a clickable header (marker, caption, summary, rule)
// over a body that is only shown while expanded. Children go in the body.
//
//   Section { title: "display"; expanded: open === "display"; onToggled: ... ; <content> }
Column {
  id: root

  property var theme: fallbackTheme
  property string title: ""
  property string summary: ""
  property bool expanded: false
  default property alias content: body.data

  signal toggled()

  spacing: Style.space(12)

  Item {
    id: header
    width: parent.width
    implicitHeight: Math.max(row.implicitHeight, Style.space(24)) + Style.space(4)
    height: implicitHeight

    Rectangle {
      anchors.fill: parent
      radius: Style.cornerRadius
      color: mouse.containsMouse ? root.theme.alpha(root.theme.foreground, 0.05) : "transparent"
    }

    Row {
      id: row
      anchors.left: parent.left
      anchors.leftMargin: Style.space(6)
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(8)

      Text {
        width: Style.space(10)
        textFormat: Text.PlainText
        text: root.expanded ? "v" : ">"
        color: root.theme.accent
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      Text {
        textFormat: Text.PlainText
        text: root.title.toUpperCase()
        color: root.expanded ? root.theme.foreground : root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
        font.letterSpacing: Style.spaceReal(1)
      }

      Text {
        visible: root.summary !== "" && !root.expanded
        textFormat: Text.PlainText
        text: root.summary
        color: root.theme.faint
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Rectangle {
      anchors.left: row.right
      anchors.leftMargin: Style.space(8)
      anchors.right: parent.right
      anchors.rightMargin: Style.space(6)
      anchors.verticalCenter: parent.verticalCenter
      height: 1
      color: root.theme.border
    }

    MouseArea {
      id: mouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: root.toggled()
    }
  }

  Column {
    id: body
    width: parent.width
    visible: root.expanded
    spacing: Style.space(14)
  }

  Theme { id: fallbackTheme }
}
