import QtQuick
import qs.Commons
import "../Time.js" as Time

// The sleep screen stack (SPEC §3):
//
//        07:14:22          large, ticking, foreground
//     rings at 07:30       medium, dim
//       in 6h 15m          small, dimmer
//
// Ring state: the large clock is replaced by the alarm's title (WAKE UP when
// it has none) in the palette's error color, the clock keeps ticking
// underneath, and the countdown becomes the elapsed time since the alarm. A
// title too wide for `maxWidth` is scaled down to fit.
//
// `sizeScale` shrinks everything for the arming dialog's mini-preview.
Item {
  id: root

  property var theme: fallbackTheme
  property var ui: theme.ui
  property real now: Date.now()
  property real ringAt: 0
  property bool ringing: false
  property real ringingSince: 0
  property real sizeScale: 1
  // The ring headline; "" shows WAKE UP.
  property string title: ""
  // The widest the headline may be (0 = no limit).
  property real maxWidth: 0

  readonly property string headlineText: root.ringing
    ? (root.title !== "" ? root.title : "WAKE UP") : root.clockText

  readonly property bool h24: ui.clock24h !== false
  readonly property bool showSeconds: ui.showSeconds !== false
  readonly property bool showRingTime: ui.showRingTime !== false
  readonly property bool showCountdown: ui.showCountdown !== false
  readonly property bool showDate: ui.showDate === true

  readonly property string clockText: Time.formatClock(root.now, { h24: root.h24, seconds: root.showSeconds })
  readonly property string ringClockText: root.ringAt > 0
    ? Time.formatClock(root.ringAt, { h24: root.h24, seconds: false }) : ""
  readonly property string countdownText: root.ringAt > 0
    ? Time.formatCountdown(Math.max(0, root.ringAt - root.now)) : ""
  readonly property string elapsedText: Time.formatElapsed(
    Math.max(0, root.now - (root.ringingSince > 0 ? root.ringingSince : root.ringAt)))

  function px(n) { return Math.max(1, Math.round(n * root.sizeScale)) }

  implicitWidth: stack.implicitWidth
  implicitHeight: stack.implicitHeight

  Column {
    id: stack
    anchors.centerIn: parent
    spacing: root.px(Style.space(10))

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.showDate
      textFormat: Text.PlainText
      text: Time.formatDate(root.now)
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: root.px(Style.font.heading)
      font.letterSpacing: root.px(Style.spaceReal(2))
    }

    // The headline's width at full size, so a long title can be fitted.
    TextMetrics {
      id: headlineMetrics
      font: headline.font
      text: root.headlineText
    }

    Text {
      id: headline
      anchors.horizontalCenter: parent.horizontalCenter
      readonly property real naturalWidth: headlineMetrics.advanceWidth
        + Math.max(0, root.headlineText.length - 1) * font.letterSpacing
      width: root.maxWidth > 0 ? Math.min(naturalWidth, root.maxWidth) : naturalWidth
      horizontalAlignment: Text.AlignHCenter
      fontSizeMode: Text.HorizontalFit
      minimumPixelSize: root.px(Style.font.display)
      textFormat: Text.PlainText
      text: root.headlineText
      color: root.ringing ? root.theme.error : root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: root.px(Style.font.displayLarge * 4)
      font.weight: Font.Light
      font.letterSpacing: root.ringing ? root.px(Style.spaceReal(8)) : 0
      font.features: { "tnum": 1 }
    }

    // In the ring state the clock keeps ticking, one size down.
    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.ringing
      textFormat: Text.PlainText
      text: root.clockText
      color: root.theme.foreground
      font.family: root.theme.fontFamily
      font.pixelSize: root.px(Style.font.displayLarge * 1.5)
      font.features: { "tnum": 1 }
    }

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.showRingTime && root.ringClockText !== ""
      textFormat: Text.PlainText
      text: (root.ringing ? "rang at " : "rings at ") + root.ringClockText
      color: root.ringing ? root.theme.error : root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: root.px(Style.font.display)
    }

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.ringing || (root.showCountdown && root.countdownText !== "")
      textFormat: Text.PlainText
      text: root.ringing ? root.elapsedText : ("in " + root.countdownText)
      color: root.theme.faint
      font.family: root.theme.fontFamily
      font.pixelSize: root.px(Style.font.heading)
      font.features: { "tnum": 1 }
    }
  }

  Theme { id: fallbackTheme }
}
