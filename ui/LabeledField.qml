import QtQuick
import qs.Commons

// "label" over a Field, with an optional hint/error line.
Column {
  id: root

  property var theme: fallbackTheme
  property string label: ""
  property string hint: ""
  property string error: ""
  property alias text: field.text
  property alias editor: field
  property string placeholder: ""

  signal edited(string text)
  signal accepted()

  spacing: Style.space(4)

  Text {
    width: parent.width
    visible: root.label !== ""
    textFormat: Text.PlainText
    text: root.label
    color: root.theme.foreground
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Field {
    id: field
    width: parent.width
    theme: root.theme
    placeholder: root.placeholder
    invalid: root.error !== ""
    onEdited: function(text) { root.edited(text) }
    onAccepted: root.accepted()
  }

  Text {
    width: parent.width
    visible: root.error !== "" || root.hint !== ""
    textFormat: Text.PlainText
    text: root.error !== "" ? root.error : root.hint
    color: root.error !== "" ? root.theme.error : root.theme.dim
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  Theme { id: fallbackTheme }
}
