pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "ui"
import "Alarms.js" as Alarms
import "Config.js" as Config
import "Time.js" as Time

// The day alarms (SPEC §17): alarms for the rest of the day that ring
// without the sleep screen, the dimming or the lockdown, and stop only when
// their challenge is solved.
//
// Every change goes straight to the service, which writes alarms.json.
Item {
  id: root

  property var theme: fallbackTheme
  property var service: null

  readonly property var alarms: root.service && root.service.alarms ? root.service.alarms : []
  readonly property var config: root.service && root.service.config ? root.service.config : ({})
  readonly property bool h24: !(root.config.ui && root.config.ui.clock24h === false)
  readonly property real now: root.service && root.service.now ? Number(root.service.now) : Date.now()
  readonly property var nextAlarm: root.service ? root.service.nextAlarm : null
  readonly property bool busy: root.service !== null && String(root.service.state || "idle") !== "idle"

  // "" is the default preset, listed first.
  readonly property var presetOptions: {
    var out = [{ value: "", label: "default" }]
    var names = Config.presetNames(root.config)
    for (var i = 0; i < names.length; i++) out.push({ value: names[i], label: names[i] })
    return out
  }

  // ---- the form ----------------------------------------------------------
  property bool formOpen: false
  property string editingId: ""
  property string title: ""
  property string timeText: ""
  property var days: []
  property string preset: ""
  property int reps: 1
  property string errorText: ""
  property string confirmDeleteId: ""

  readonly property var dayPresets: [
    { value: "once", label: "once", days: [] },
    { value: "weekdays", label: "weekdays", days: [1, 2, 3, 4, 5] },
    { value: "weekends", label: "weekends", days: [0, 6] },
    { value: "every", label: "every day", days: [0, 1, 2, 3, 4, 5, 6] }
  ]

  readonly property string dayPresetValue: {
    var key = Alarms.normalizeDays(root.days).join(",")
    for (var i = 0; i < root.dayPresets.length; i++) {
      if (root.dayPresets[i].days.join(",") === key) return root.dayPresets[i].value
    }
    return ""
  }

  function openNew() {
    root.editingId = ""
    root.title = ""
    root.timeText = ""
    root.days = []
    root.preset = ""
    root.reps = 1
    root.errorText = ""
    root.confirmDeleteId = ""
    root.formOpen = true
  }

  function openEdit(alarm) {
    root.editingId = String(alarm.id)
    root.title = String(alarm.title || "")
    root.timeText = String(alarm.time || "")
    root.days = Alarms.normalizeDays(alarm.days)
    root.preset = String(alarm.preset || "")
    root.reps = Math.max(1, Number(alarm.reps) || 1)
    root.errorText = ""
    root.confirmDeleteId = ""
    root.formOpen = true
  }

  function closeForm() {
    root.formOpen = false
    root.editingId = ""
    root.errorText = ""
  }

  function toggleDay(day) {
    var next = Alarms.normalizeDays(root.days)
    var i = next.indexOf(day)
    if (i >= 0) next.splice(i, 1)
    else next.push(day)
    root.days = Alarms.normalizeDays(next)
  }

  function save() {
    root.errorText = ""
    if (!root.service || typeof root.service.addAlarm !== "function") {
      root.errorText = "the get-the-f-up service is not running"
      return
    }
    var fields = {
      title: root.title,
      time: root.timeText,
      days: root.days,
      preset: root.preset,
      reps: root.reps,
      enabled: true
    }
    var result = root.editingId !== ""
      ? root.service.updateAlarm(root.editingId, fields)
      : root.service.addAlarm(fields)
    if (!result || result.ok === false) {
      root.errorText = String((result && result.error) || root.service.lastError || "could not save the alarm")
      return
    }
    root.closeForm()
  }

  function remove(alarm) {
    if (root.confirmDeleteId !== String(alarm.id)) {
      root.confirmDeleteId = String(alarm.id)
      return
    }
    root.confirmDeleteId = ""
    if (root.editingId === String(alarm.id)) root.closeForm()
    if (root.service) root.service.removeAlarm(alarm.id)
  }

  function nextText(alarm) {
    var at = Alarms.pending(alarm)
    if (at === 0) return "off"
    var when = Time.formatClock(at, { h24: root.h24, seconds: false })
    var sameDay = new Date(at).toDateString() === new Date(root.now).toDateString()
    var day = sameDay ? "today" : Time.formatDate(at)
    return day + " " + when + "  ·  in " + Time.formatCompact(Math.max(0, at - root.now))
  }

  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(10)

    SectionHeader {
      width: parent.width
      theme: root.theme
      text: "day alarms"
    }

    Text {
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: "Alarms for the rest of the day. They ring with a fullscreen title and stop only when the challenge is solved, but nothing is dimmed or locked down. One missed by up to an hour (suspended, shell off) still rings; an older one is reported as missed."
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
    }

    Text {
      width: parent.width
      wrapMode: Text.WordWrap
      textFormat: Text.PlainText
      text: root.nextAlarm
        ? "next: " + Alarms.displayTitle(root.nextAlarm.alarm) + " at "
          + Time.formatClock(root.nextAlarm.at, { h24: root.h24, seconds: false })
          + "  ·  in " + Time.formatCompact(Math.max(0, root.nextAlarm.at - root.now))
        : (root.alarms.length === 0 ? "no alarms yet" : "no alarm is scheduled")
      color: root.nextAlarm ? root.theme.accent : root.theme.faint
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    // ---- the list --------------------------------------------------------
    Repeater {
      model: root.alarms

      Card {
        id: row
        required property var modelData

        width: column.width
        height: rowColumn.implicitHeight + Style.space(10) * 2
        theme: root.theme
        highlighted: root.editingId === String(row.modelData.id)

        Column {
          id: rowColumn
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.leftMargin: Style.space(12)
          anchors.rightMargin: Style.space(12)
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(6)

          Item {
            width: parent.width
            height: Math.max(timeText.implicitHeight, rowButtons.height)

            Text {
              id: timeText
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: String(row.modelData.time)
              color: row.modelData.enabled ? root.theme.foreground : root.theme.faint
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.title
              font.features: { "tnum": 1 }
            }

            Text {
              anchors.left: timeText.right
              anchors.leftMargin: Style.space(10)
              anchors.right: rowButtons.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              elide: Text.ElideRight
              textFormat: Text.PlainText
              text: Alarms.displayTitle(row.modelData)
              color: row.modelData.enabled ? root.theme.accent : root.theme.faint
              font.family: root.theme.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.bold: true
            }

            Row {
              id: rowButtons
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              Button {
                theme: root.theme
                compact: true
                text: row.modelData.enabled ? "on" : "off"
                selected: row.modelData.enabled === true
                tooltip: "switch this alarm on or off"
                onClicked: if (root.service) root.service.setAlarmEnabled(row.modelData.id, !row.modelData.enabled)
              }

              Button {
                theme: root.theme
                compact: true
                text: "edit"
                onClicked: root.openEdit(row.modelData)
              }

              Button {
                theme: root.theme
                compact: true
                text: "test"
                enabled: !root.busy
                tooltip: "ring it now: plays the alarm, no history entry"
                onClicked: if (root.service) root.service.testAlarm(row.modelData.id)
              }

              Button {
                theme: root.theme
                compact: true
                kind: "danger"
                text: root.confirmDeleteId === String(row.modelData.id) ? "sure?" : "delete"
                onClicked: root.remove(row.modelData)
              }
            }
          }

          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            textFormat: Text.PlainText
            text: Alarms.describeDays(row.modelData.days)
              + "  ·  " + (row.modelData.preset ? row.modelData.preset : "default preset")
              + (Number(row.modelData.reps) > 1 ? " x" + row.modelData.reps : "")
              + "  ·  " + root.nextText(row.modelData)
            color: root.theme.dim
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }

    Button {
      visible: !root.formOpen
      theme: root.theme
      kind: "accent"
      text: "new alarm"
      onClicked: root.openNew()
    }

    // ---- the form --------------------------------------------------------
    Card {
      width: parent.width
      visible: root.formOpen
      height: formColumn.implicitHeight + Style.space(14) * 2
      theme: root.theme
      highlighted: true

      Column {
        id: formColumn
        anchors.centerIn: parent
        width: parent.width - Style.space(14) * 2
        spacing: Style.space(10)

        SectionHeader {
          width: parent.width
          theme: root.theme
          text: root.editingId !== "" ? "edit alarm" : "new alarm"
        }

        LabeledField {
          width: parent.width
          theme: root.theme
          label: "title"
          hint: "the headline when it rings. empty shows ALARM"
          placeholder: "standup"
          text: root.title
          editor.maximumLength: 40
          onEdited: function(value) { root.title = value }
        }

        LabeledField {
          width: parent.width
          theme: root.theme
          label: "time"
          hint: "24-hour clock (14:30)"
          placeholder: "14:30"
          text: root.timeText
          onEdited: function(value) { root.timeText = value }
          onAccepted: root.save()
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: "repeat"
          color: root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Choice {
          width: parent.width
          theme: root.theme
          options: root.dayPresets
          value: root.dayPresetValue
          onChosen: function(value) {
            for (var i = 0; i < root.dayPresets.length; i++) {
              if (root.dayPresets[i].value === value) root.days = root.dayPresets[i].days.slice()
            }
          }
        }

        Flow {
          width: parent.width
          spacing: Style.space(6)

          Repeater {
            model: [1, 2, 3, 4, 5, 6, 0]

            Button {
              required property var modelData
              theme: root.theme
              compact: true
              text: Alarms.DAY_NAMES[modelData]
              selected: root.days.indexOf(modelData) >= 0
              onClicked: root.toggleDay(modelData)
            }
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: "challenge"
          color: root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Choice {
          width: parent.width
          theme: root.theme
          options: root.presetOptions
          value: root.preset
          onChosen: function(value) { root.preset = String(value) }
        }

        Spinner {
          width: parent.width
          theme: root.theme
          label: "challenges required"
          value: root.reps
          from: 1
          to: Alarms.REPS_MAX
          onModified: function(value) { root.reps = value }
        }

        Row {
          width: parent.width
          spacing: Style.space(8)

          Button {
            theme: root.theme
            kind: "accent"
            text: root.editingId !== "" ? "save" : "add"
            onClicked: root.save()
          }

          Button {
            theme: root.theme
            text: "cancel"
            onClicked: root.closeForm()
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            width: Math.max(0, parent.width - Style.space(160))
            wrapMode: Text.WordWrap
            visible: root.errorText !== ""
            textFormat: Text.PlainText
            text: root.errorText
            color: root.theme.error
            font.family: root.theme.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }

  Theme { id: fallbackTheme }
}
