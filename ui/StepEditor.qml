pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "../Steps.js" as Steps

// Editor for one challenge step spec.
//
// A step spec is the config object itself (SPEC §4): { "type": "math",
// "operators": "+-x", "maxOperand": 20, "tier": "easy" }. The editor never
// mutates the spec it was given: it works on a copy and emits `changed(spec)`
// so the owner decides where the copy goes.
//
// The same editor edits a preset step and a pool entry; `showWeight` adds the
// pool's draw weight, `showListActions` adds the reorder/remove buttons.
Item {
  id: root

  property var theme: fallbackTheme
  property var spec: ({})
  property bool showWeight: false
  property int weight: 1
  property bool showListActions: false
  property string previewText: ""

  signal changed(var spec)
  // Named `weightEdited`, not `weightChanged`: the `weight` property already
  // generates a `weightChanged` signal of its own.
  signal weightEdited(int weight)
  signal moveUpRequested()
  signal moveDownRequested()
  signal removeRequested()

  readonly property string type: root.spec && root.spec.type ? String(root.spec.type) : "math"

  function num(key, fallback) {
    var v = root.spec ? root.spec[key] : undefined
    return typeof v === "number" && isFinite(v) ? v : fallback
  }

  function str(key, fallback) {
    var v = root.spec ? root.spec[key] : undefined
    return typeof v === "string" ? v : fallback
  }

  function copySpec() {
    var next = {}
    if (root.spec) for (var k in root.spec) next[k] = root.spec[k]
    return next
  }

  function patch(key, value) {
    var next = root.copySpec()
    next[key] = value
    root.changed(next)
  }

  function setType(value) {
    if (value === root.type) return
    var next = { type: value }
    if (value === "math") {
      next.operators = "+-"
      next.maxOperand = 20
      next.tier = "easy"
    } else if (value === "string") {
      next.charset = "alnum"
      next.length = 8
    } else if (value === "memory") {
      next.length = 4
    }
    root.previewText = ""
    root.changed(next)
  }

  function describeSpec() {
    try { return Steps.describe(root.spec) } catch (e) { return String(root.type) }
  }

  // One throwaway instance of this step, so the user can see what it asks
  // for without touching the camera or a live challenge.
  function sample() {
    try {
      var instance = Steps.sample(root.spec)
      if (!instance) { root.previewText = ""; return }
      if (instance.type === "math") {
        root.previewText = instance.prompt + " = " + instance.expected
      } else if (instance.type === "string") {
        root.previewText = instance.prompt
      } else if (instance.type === "memory") {
        root.previewText = instance.prompt
      } else {
        root.previewText = "the light check, against the global threshold"
      }
    } catch (e) {
      root.previewText = "this step cannot be sampled"
    }
  }

  implicitWidth: column.implicitWidth
  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(8)

    // ---- header: description + actions -----------------------------------
    Item {
      id: header
      width: parent.width
      height: Style.space(30)

      Text {
        id: description
        anchors.left: parent.left
        anchors.right: actions.left
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        textFormat: Text.PlainText
        text: root.describeSpec()
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Row {
        id: actions
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(4)

        Button {
          theme: root.theme
          compact: true
          text: "preview"
          onClicked: root.sample()
        }

        Button {
          theme: root.theme
          compact: true
          text: "up"
          visible: root.showListActions
          onClicked: root.moveUpRequested()
        }

        Button {
          theme: root.theme
          compact: true
          text: "down"
          visible: root.showListActions
          onClicked: root.moveDownRequested()
        }

        Button {
          theme: root.theme
          compact: true
          kind: "danger"
          text: "remove"
          visible: root.showListActions
          onClicked: root.removeRequested()
        }
      }
    }

    // ---- type + weight ----------------------------------------------------
    Item {
      id: typeRow
      width: parent.width
      height: Math.max(typeChoice.implicitHeight, weightSpinner.implicitHeight)

      Choice {
        id: typeChoice
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        // Bounded, so it wraps instead of running under the weight stepper.
        width: root.showWeight ? parent.width - weightSpinner.width - Style.space(12) : parent.width
        theme: root.theme
        options: ["math", "string", "memory"]
        value: root.type
        onChosen: function(value) { root.setType(String(value)) }
      }

      Spinner {
        id: weightSpinner
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: root.showWeight
        theme: root.theme
        label: "weight"
        value: root.weight
        from: 0
        to: 20
        onModified: function(value) { root.weightEdited(value) }
      }
    }

    // ---- math parameters --------------------------------------------------
    Column {
      width: parent.width
      spacing: Style.space(6)
      visible: root.type === "math"

      LabeledField {
        width: parent.width
        theme: root.theme
        label: "operators"
        hint: "+ - x / (any order)"
        placeholder: "+-x"
        text: root.str("operators", "+-")
        onEdited: function(value) { root.patch("operators", value) }
      }

      Spinner {
        id: maxSpinner
        width: parent.width
        theme: root.theme
        label: "max operand"
        value: root.num("maxOperand", 20)
        from: 2
        to: 1000
        onModified: function(value) { root.patch("maxOperand", value) }
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "difficulty"
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Choice {
        id: tierChoice
        width: parent.width
        theme: root.theme
        options: ["easy", "medium", "hard"]
        value: root.str("tier", "easy")
        onChosen: function(value) { root.patch("tier", String(value)) }
      }

      Spinner {
        width: parent.width
        theme: root.theme
        label: "decimals"
        hint: "0 keeps every answer a whole number"
        value: root.num("decimals", 0)
        from: 0
        to: 3
        onModified: function(value) { root.patch("decimals", value) }
      }
    }

    // ---- string parameters ------------------------------------------------
    Column {
      width: parent.width
      spacing: Style.space(6)
      visible: root.type === "string"

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "characters"
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Choice {
        id: charsetChoice
        width: parent.width
        theme: root.theme
        options: ["alnum", "alpha", "lower", "upper", "digits", "hex", "symbols"]
        value: root.str("charset", "alnum")
        onChosen: function(value) { root.patch("charset", String(value)) }
      }

      Spinner {
        id: lengthSpinner
        width: parent.width
        theme: root.theme
        label: "length"
        value: root.num("length", 8)
        from: 1
        to: 64
        onModified: function(value) { root.patch("length", value) }
      }
    }

    // ---- memory parameters ------------------------------------------------
    Spinner {
      width: parent.width
      visible: root.type === "memory"
      theme: root.theme
      label: "digits"
      hint: "the sequence flashes, then hides"
      value: root.num("length", 4)
      from: 1
      to: 20
      onModified: function(value) { root.patch("length", value) }
    }

    // ---- camera parameters ------------------------------------------------
    Text {
      width: parent.width
      visible: root.type === "camera"
      textFormat: Text.PlainText
      text: "the light threshold is global: set it once under settings > camera. every camera step uses it."
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }

    // ---- sample output ----------------------------------------------------
    Text {
      width: parent.width
      visible: root.previewText !== ""
      wrapMode: Text.WrapAnywhere
      textFormat: Text.PlainText
      text: root.previewText
      color: root.theme.accent
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Theme { id: fallbackTheme }
}
