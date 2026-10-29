import QtQuick
import qs.Commons

// Single-line monospace input inside a 1 px QML-drawn border.
Rectangle {
  id: root

  property var theme: fallbackTheme
  property alias text: input.text
  property alias editor: input
  property string placeholder: ""
  property string prefix: ""
  property bool invalid: false
  property int maximumLength: 256
  property real fontSize: Style.font.body

  signal accepted()
  signal edited(string text)

  implicitWidth: Style.space(180)
  implicitHeight: Math.max(input.implicitHeight, prefixLabel.implicitHeight) + Style.space(7) * 2
  radius: Style.cornerRadius
  color: theme.surface
  border.width: 1
  border.color: invalid ? theme.error : (input.activeFocus ? theme.accent : theme.border)

  Text {
    id: prefixLabel
    visible: root.prefix !== ""
    anchors.left: parent.left
    anchors.leftMargin: Style.space(10)
    anchors.verticalCenter: parent.verticalCenter
    textFormat: Text.PlainText
    text: root.prefix
    color: root.theme.accent
    font.family: root.theme.fontFamily
    font.pixelSize: root.fontSize
  }

  TextInput {
    id: input
    anchors.left: prefixLabel.visible ? prefixLabel.right : parent.left
    anchors.leftMargin: prefixLabel.visible ? Style.space(6) : Style.space(10)
    anchors.right: parent.right
    anchors.rightMargin: Style.space(10)
    anchors.verticalCenter: parent.verticalCenter
    clip: true
    color: root.theme.foreground
    selectionColor: root.theme.alpha(root.theme.accent, 0.4)
    selectedTextColor: root.theme.foreground
    font.family: root.theme.fontFamily
    font.pixelSize: root.fontSize
    selectByMouse: true
    maximumLength: root.maximumLength
    onTextEdited: root.edited(text)
    onAccepted: root.accepted()

    // Escape leaves the field instead of closing the panel that hosts it.
    // The handler runs on the focused item, so accepting the key here stops
    // it before the panel's own key catcher ever sees it.
    Keys.onEscapePressed: function(event) {
      input.focus = false
      event.accepted = true
    }
  }

  Text {
    anchors.fill: input
    verticalAlignment: Text.AlignVCenter
    visible: input.text === ""
    textFormat: Text.PlainText
    text: root.placeholder
    color: root.theme.faint
    font.family: root.theme.fontFamily
    font.pixelSize: root.fontSize
    elide: Text.ElideRight
  }

  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.NoButton
    cursorShape: Qt.IBeamCursor
  }

  Theme { id: fallbackTheme }
}
