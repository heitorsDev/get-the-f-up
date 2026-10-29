pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// Segmented single choice. `options` is an array of strings or
// { value, label } objects; `chosen(value)` fires on click.
Flow {
  id: root

  property var theme: fallbackTheme
  property var options: []
  property var value: null
  property bool compact: true

  signal chosen(var value)

  spacing: Style.space(6)

  Repeater {
    model: root.options

    Button {
      required property var modelData
      readonly property var optionValue: (modelData !== null && typeof modelData === "object") ? modelData.value : modelData
      theme: root.theme
      compact: root.compact
      text: (modelData !== null && typeof modelData === "object") ? String(modelData.label) : String(modelData)
      selected: optionValue === root.value
      onClicked: root.chosen(optionValue)
    }
  }

  Theme { id: fallbackTheme }
}
