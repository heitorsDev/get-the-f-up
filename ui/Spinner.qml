import QtQuick
import qs.Commons

// Integer stepper: "label            [-] [ 3 ] [+]".
//
// The number in the middle is a typed field, so a big value is entered
// directly instead of clicked to. A value inside from..to is applied as it
// is typed; one outside the range is flagged while typing and clamped when
// the field loses focus or Enter is pressed. Holding - or + repeats, and the
// step grows the longer it is held.
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

  readonly property bool editing: field.editor.activeFocus
  readonly property var typed: {
    var n = parseInt(field.text, 10)
    return isNaN(n) ? null : n
  }
  readonly property bool outOfRange: root.editing && field.text !== ""
    && (root.typed === null || root.typed < root.from || root.typed > root.to)

  // What the field shows while it is not being edited. Zero with a zeroText
  // shows the empty field, so the zeroText placeholder reads instead.
  function shown() {
    return root.textFor(root.value)
  }

  function clamp(n) {
    return Math.max(root.from, Math.min(root.to, n))
  }

  // How far one repeat moves: the step grows while a button is held, and
  // big steps land on round numbers.
  function stepFor(repeats) {
    var span = root.to - root.from
    var factor = 1
    if (repeats >= 24 && span >= 200) factor = 50
    else if (repeats >= 16 && span >= 100) factor = 10
    else if (repeats >= 8 && span >= 20) factor = 5
    return root.stepSize * factor
  }

  function bump(direction, repeats) {
    if (root.editing) root.commit()
    var step = root.stepFor(repeats || 0)
    var next = root.value + direction * step
    if (step > root.stepSize) {
      next = direction > 0 ? Math.floor(next / step) * step : Math.ceil(next / step) * step
    }
    next = root.clamp(next)
    if (next !== root.value) root.modified(next)
    if (root.editing) field.text = root.textFor(next)
  }

  function textFor(n) {
    return n === 0 && root.zeroText !== "" ? "" : String(n)
  }

  function commit() {
    var n = root.typed
    if (n === null) {
      if (field.text === "" && root.zeroText !== "" && root.from <= 0) {
        if (root.value !== 0) root.modified(0)
        field.text = ""
        return
      }
      field.text = root.shown()
      return
    }
    var next = root.clamp(n)
    if (next !== root.value) root.modified(next)
    field.text = root.textFor(next)
  }

  onValueChanged: {
    if (!root.editing) field.text = root.shown()
  }
  onZeroTextChanged: {
    if (!root.editing) field.text = root.shown()
  }
  Component.onCompleted: {
    field.text = root.shown()
    field.editor.validator = digits
    field.editor.inputMethodHints = Qt.ImhDigitsOnly
    field.editor.horizontalAlignment = TextInput.AlignHCenter
  }

  implicitWidth: labelColumn.implicitWidth + controls.width + Style.space(12)
  implicitHeight: Math.max(labelColumn.implicitHeight, controls.height)
  opacity: enabled ? 1 : 0.45

  RegularExpressionValidator {
    id: digits
    regularExpression: /[0-9]*/
  }

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
      visible: root.hint !== "" || root.outOfRange
      textFormat: Text.PlainText
      text: root.outOfRange ? ("enter a number from " + root.from + " to " + root.to) : root.hint
      color: root.outOfRange ? root.theme.error : root.theme.dim
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
      id: minus
      anchors.verticalCenter: parent.verticalCenter
      theme: root.theme
      compact: true
      text: "-"
      autoRepeat: true
      enabled: root.value > root.from
      onClicked: root.bump(-1, minus.repeatCount)
    }

    Field {
      id: field
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(Math.max(52, 14 + 10 * String(root.to).length))
      theme: root.theme
      fontSize: Style.font.bodySmall
      placeholder: root.zeroText
      maximumLength: String(root.to).length
      invalid: root.outOfRange
      onEdited: {
        var n = root.typed
        if (n !== null && n >= root.from && n <= root.to && n !== root.value) root.modified(n)
      }
      onAccepted: root.commit()
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      visible: root.suffix !== ""
      textFormat: Text.PlainText
      text: root.suffix
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Button {
      id: plus
      anchors.verticalCenter: parent.verticalCenter
      theme: root.theme
      compact: true
      text: "+"
      autoRepeat: true
      enabled: root.value < root.to
      onClicked: root.bump(1, plus.repeatCount)
    }
  }

  Connections {
    target: field.editor
    function onActiveFocusChanged() {
      if (!field.editor.activeFocus) root.commit()
    }
  }

  Theme { id: fallbackTheme }
}
