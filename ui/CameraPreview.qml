pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import "../Camera.js" as Camera

// The camera check, live: a preview frame, the current brightness on the same
// 16..235 scale the light threshold uses, and what that reading would mean
// against the thresholds being edited.
//
// The camera stays closed until the button is pressed, and is released again
// when this item is hidden or destroyed.
Card {
  id: root

  property var service: null
  // The thresholds being edited (the unsaved draft), so the verdict follows
  // the typing.
  property int threshold: 60
  property int cutoff: 24
  property string device: ""

  // The user asked for the camera on; the service reports whether it is.
  property bool wanted: false

  signal thresholdPicked(int value)

  readonly property bool live: root.service ? root.service.cameraLive === true : false
  readonly property real luma: root.service && root.service.cameraLuma !== undefined
    ? Number(root.service.cameraLuma) : -1
  readonly property real spread: root.service && root.service.cameraSpread !== undefined
    ? Number(root.service.cameraSpread) : -1
  readonly property string error: root.service && root.service.cameraLiveError
    ? String(root.service.cameraLiveError) : ""
  readonly property string verdict: Camera.verdict(root.luma, root.spread,
    { lightThreshold: root.threshold, nearBlackCutoff: root.cutoff })

  // A keepLoaded service is not replaced by a plugin hot reload, so right
  // after an update the panel can be newer than the service it talks to.
  readonly property bool outdated: root.service !== null
    && typeof root.service.startCameraLive !== "function"

  readonly property real scaleMin: 16
  readonly property real scaleMax: 235

  function fraction(value) {
    return Math.max(0, Math.min(1, (Number(value) - root.scaleMin) / (root.scaleMax - root.scaleMin)))
  }

  function errorText(code) {
    switch (code) {
    case "EACCES": return "no permission to open the camera"
    case "EBUSY": return "another app is using the camera"
    case "ENOENT": return "that device does not exist"
    case "ENODEV": return "that device is not a camera"
    default: return code
    }
  }

  function verdictText() {
    switch (root.verdict) {
    case "on": return "light on - the check would pass"
    case "dim": return "too dim - the check would not pass"
    case "blocked": return "black and flat - lens blocked, the step would be skipped"
    default: return "waiting for the first frame"
    }
  }

  function start() {
    if (!root.service || root.outdated) return
    root.wanted = true
    root.service.startCameraLive(root.device)
  }

  function stop() {
    root.wanted = false
    if (root.service) root.service.stopCameraLive()
  }

  onVisibleChanged: if (!root.visible && root.wanted) root.stop()
  Component.onDestruction: if (root.wanted) root.stop()
  // The service stops the stream on its own (an error, the time cap, a
  // session starting); follow it so the button is never stale.
  onLiveChanged: if (!root.live && root.wanted && root.error === "") root.wanted = false

  implicitHeight: column.implicitHeight + Style.space(16) * 2

  Column {
    id: column
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.margins: Style.space(16)
    spacing: Style.space(10)

    Row {
      width: parent.width
      spacing: Style.space(10)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width - toggle.width - Style.space(10)
        textFormat: Text.PlainText
        text: "live preview"
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Button {
        id: toggle
        anchors.verticalCenter: parent.verticalCenter
        theme: root.theme
        compact: true
        kind: root.wanted ? "normal" : "accent"
        text: root.wanted ? "hide preview" : "show preview"
        enabled: root.service !== null && !root.outdated
        onClicked: root.wanted ? root.stop() : root.start()
      }
    }

    Text {
      width: parent.width
      visible: root.outdated
      textFormat: Text.PlainText
      text: "the running service is older than this panel. restart the shell to enable the preview: omarchy-restart-shell"
      color: root.theme.error
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }

    Text {
      width: parent.width
      visible: !root.wanted && !root.outdated
      textFormat: Text.PlainText
      text: "the camera stays off until you press the button. frames are kept in memory-backed storage only while the preview is on, and deleted when it stops."
      color: root.theme.dim
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }

    // ---- the frame ---------------------------------------------------------
    Rectangle {
      width: parent.width
      height: Math.round(width * 0.75)
      visible: root.wanted
      radius: Style.cornerRadius
      color: "#000000"
      border.width: 1
      border.color: root.theme.border
      clip: true

      Image {
        anchors.fill: parent
        anchors.margins: 1
        visible: status === Image.Ready
        fillMode: Image.PreserveAspectFit
        // A selfie view: moving left moves left on screen.
        mirror: true
        cache: false
        asynchronous: true
        source: root.service && root.service.cameraFrame !== ""
          ? root.service.cameraFrame + "?" + root.service.cameraFrameSeq : ""
      }

      Text {
        anchors.centerIn: parent
        width: parent.width - Style.space(24)
        horizontalAlignment: Text.AlignHCenter
        visible: root.error !== "" || root.luma < 0
        textFormat: Text.PlainText
        text: root.error !== "" ? root.errorText(root.error) : "opening the camera..."
        color: root.error !== "" ? root.theme.error : root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.WordWrap
      }
    }

    // ---- the reading -------------------------------------------------------
    Row {
      width: parent.width
      visible: root.wanted
      spacing: Style.space(12)

      Text {
        id: lumaText
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(64)
        textFormat: Text.PlainText
        text: root.luma >= 0 ? String(Math.round(root.luma)) : "--"
        color: root.verdict === "on" ? root.theme.success
          : (root.verdict === "unknown" ? root.theme.dim : root.theme.accent)
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.body * 2
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width - lumaText.width - Style.space(12)
        textFormat: Text.PlainText
        text: root.verdictText()
        color: root.theme.foreground
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.WordWrap
      }
    }

    // The level on the 16 (black) .. 235 (white) scale, with the threshold
    // (accent) and the near-black cutoff (dim) marked on it.
    Item {
      width: parent.width
      height: Style.space(22)
      visible: root.wanted

      Rectangle {
        id: track
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: Style.space(8)
        radius: Style.cornerRadius
        color: root.theme.alpha(root.theme.foreground, 0.06)
        border.width: 1
        border.color: root.theme.border

        Rectangle {
          anchors.left: parent.left
          anchors.top: parent.top
          anchors.bottom: parent.bottom
          width: Math.round(parent.width * root.fraction(root.luma >= 0 ? root.luma : root.scaleMin))
          radius: parent.radius
          color: root.verdict === "on" ? root.theme.success : root.theme.alpha(root.theme.dim, 0.7)
        }

        Rectangle {
          x: Math.round(parent.width * root.fraction(root.cutoff)) - 1
          y: -Style.space(3)
          width: 2
          height: parent.height + Style.space(6)
          color: root.theme.dim
        }

        Rectangle {
          x: Math.round(parent.width * root.fraction(root.threshold)) - 1
          y: -Style.space(3)
          width: 2
          height: parent.height + Style.space(6)
          color: root.theme.accent
        }
      }

      Text {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        textFormat: Text.PlainText
        text: "16 black"
        color: root.theme.faint
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Text {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        textFormat: Text.PlainText
        text: "235 white"
        color: root.theme.faint
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.caption
      }

      Row {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        spacing: Style.space(10)

        Text {
          textFormat: Text.PlainText
          text: "| threshold"
          color: root.theme.accent
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }

        Text {
          textFormat: Text.PlainText
          text: "| cutoff"
          color: root.theme.dim
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }

    Button {
      theme: root.theme
      compact: true
      visible: root.wanted
      enabled: root.luma >= 0
      text: "use the current level as the threshold"
      onClicked: root.thresholdPicked(Math.round(root.luma))
    }
  }
}
