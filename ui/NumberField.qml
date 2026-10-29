import QtQuick
import qs.Commons

// Typed integer: "label            [ 60 ]".
//
// Digits only. A value inside from..to is applied as it is typed, so anything
// bound to it (a live marker, a verdict) follows the keystrokes; a value
// outside the range is flagged while typing and clamped when the field loses
// focus or Enter is pressed.
Item {
  id: root

  property var theme: fallbackTheme
  property string label: ""
  property string hint: ""
  property string suffix: ""
  property int value: 0
  property int from: 0
  property int to: 100

  signal modified(int value)

  readonly property var typed: {
    var n = parseInt(field.text, 10)
    return isNaN(n) ? null : n
  }
  readonly property bool outOfRange: field.text !== "" && (root.typed === null
    || root.typed < root.from || root.typed > root.to)

  function commit() {
    var n = root.typed
    if (n === null) {
      field.text = String(root.value)
      return
    }
    var next = Math.max(root.from, Math.min(root.to, n))
    field.text = String(next)
    if (next !== root.value) root.modified(next)
  }

  onValueChanged: {
    if (!field.editor.activeFocus) field.text = String(root.value)
  }
  Component.onCompleted: {
    field.text = String(root.value)
    field.editor.validator = digits
    field.editor.inputMethodHints = Qt.ImhDigitsOnly
  }

  implicitWidth: labelColumn.implicitWidth + field.width + Style.space(12)
  implicitHeight: Math.max(labelColumn.implicitHeight, field.implicitHeight)
  opacity: enabled ? 1 : 0.45

  RegularExpressionValidator {
    id: digits
    regularExpression: /[0-9]*/
  }

  Column {
    id: labelColumn
    anchors.left: parent.left
    anchors.right: field.left
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
      visible: root.hint !== "" || root.outOfRange
      textFormat: Text.PlainText
      text: root.outOfRange ? ("enter a number from " + root.from + " to " + root.to) : root.hint
      color: root.outOfRange ? root.theme.error : root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  Field {
    id: field
    anchors.right: suffixLabel.visible ? suffixLabel.left : parent.right
    anchors.rightMargin: suffixLabel.visible ? Style.space(6) : 0
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(76)
    theme: root.theme
    maximumLength: 4
    invalid: root.outOfRange
    onEdited: {
      var n = root.typed
      if (n !== null && n >= root.from && n <= root.to && n !== root.value) root.modified(n)
    }
    onAccepted: root.commit()
  }

  Text {
    id: suffixLabel
    visible: root.suffix !== ""
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    textFormat: Text.PlainText
    text: root.suffix
    color: root.theme.dim
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Connections {
    target: field.editor
    function onActiveFocusChanged() {
      if (!field.editor.activeFocus) root.commit()
    }
  }

  Theme { id: fallbackTheme }
}
