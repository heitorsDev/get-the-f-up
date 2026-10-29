pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// A themed menu list: one row per entry, hover-highlighted, with an optional
// dim hint on the right.
//
// `entries` is an array of { key, label, hint } objects; `chosen(key)` fires
// on click. Rows are QML-drawn rounded rectangles, never unicode box glyphs
// (SPEC §3, decision U2).
Item {
  id: root

  property var theme: fallbackTheme
  property var entries: []

  signal chosen(string key)

  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(2)

    Repeater {
      model: root.entries

      Rectangle {
        id: row
        required property var modelData

        width: column.width
        height: Style.space(32)
        radius: Style.cornerRadius
        color: mouse.containsMouse ? root.theme.surfaceHover : "transparent"

        Behavior on color { ColorAnimation { duration: 90 } }

        Text {
          anchors.left: parent.left
          anchors.leftMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: String(row.modelData.label || "")
          color: root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          anchors.right: parent.right
          anchors.rightMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          visible: String(row.modelData.hint || "") !== ""
          textFormat: Text.PlainText
          text: String(row.modelData.hint || "")
          color: root.theme.faint
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }

        MouseArea {
          id: mouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.chosen(String(row.modelData.key || ""))
        }
      }
    }
  }

  Theme { id: fallbackTheme }
}
