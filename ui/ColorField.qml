import QtQuick
import qs.Commons

// One editable palette token: swatch + "#rrggbb" field. Emits `changed`
// only for a valid 6- or 8-digit hex value.
Item {
  id: root

  property var theme: fallbackTheme
  property string token: ""
  property string value: ""
  property string draftText: value

  readonly property bool valid: /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(draftText)

  signal colorEdited(string token, string value)

  onValueChanged: draftText = value

  implicitWidth: Style.space(220)
  implicitHeight: field.implicitHeight

  Text {
    id: name
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(84)
    textFormat: Text.PlainText
    text: root.token
    color: root.theme.foreground
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Rectangle {
    id: swatch
    anchors.left: name.right
    anchors.verticalCenter: parent.verticalCenter
    width: field.height
    height: field.height
    radius: Style.cornerRadius
    color: root.valid ? root.draftText : "transparent"
    border.width: 1
    border.color: root.theme.border
  }

  Field {
    id: field
    anchors.left: swatch.right
    anchors.leftMargin: Style.space(8)
    anchors.right: parent.right
    theme: root.theme
    text: root.value
    invalid: !root.valid
    maximumLength: 9
    onEdited: function(text) {
      root.draftText = text
      if (root.valid) root.colorEdited(root.token, text)
    }
  }

  Theme { id: fallbackTheme }
}
