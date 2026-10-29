import QtQuick
import qs.Commons

// The challenge surface (SPEC §4). Purely a view: the typed draft, the
// "not quite" flash, the memory flash and the last outcome live on `host`
// (the Overlay root) so every monitor renders the same thing no matter
// which surface holds the keyboard.
//
// host contract (Overlay.qml):
//   draft, wrongFlash, outcomeText, outcomeKind ("success"|"skip"|"error"|""),
//   memoryVisible, inputLocked, capture(), submitDraft(), and for the camera
//   step: cameraFrame, cameraFrameSeq, cameraLuma, cameraProgress, cameraHold,
//   cameraVerdict, cameraError, lightThreshold
Item {
  id: root

  property var theme: fallbackTheme
  property var host: null
  property var view: null
  property string cameraStatus: "idle"

  readonly property string type: view && view.type ? String(view.type) : ""
  readonly property var instance: view && view.instance ? view.instance : ({})
  readonly property int rep: view ? Number(view.rep || 0) : 0
  readonly property int reps: view ? Math.max(1, Number(view.reps || 1)) : 1
  readonly property int stepIndex: view ? Number(view.stepIndex || 0) : 0
  readonly property int stepCount: view ? Math.max(1, Number(view.stepCount || 1)) : 1
  readonly property int completedSteps: view ? Number(view.completedSteps || 0) : 0
  readonly property int totalSteps: view ? Math.max(1, Number(view.totalSteps || 1)) : 1
  readonly property bool capturing: cameraStatus === "capturing"

  readonly property string cameraMessage: {
    var code = root.host ? String(root.host.cameraError) : ""
    if (code === "EACCES") return "no permission to open the camera"
    if (code === "EBUSY") return "another app is using the camera"
    if (code === "ENOENT" || code === "ENODEV") return "no camera found"
    if (code !== "") return code
    return root.host && Number(root.host.cameraLuma) < 0 ? "opening the camera..." : ""
  }

  readonly property string draft: host ? String(host.draft || "") : ""
  readonly property bool wrongFlash: host ? host.wrongFlash === true : false
  readonly property string outcomeText: host ? String(host.outcomeText || "") : ""
  readonly property string outcomeKind: host ? String(host.outcomeKind || "") : ""
  readonly property bool memoryVisible: host ? host.memoryVisible === true : false

  readonly property string verb: {
    if (type === "math") return "solve"
    if (type === "string") return "retype exactly"
    if (type === "memory") return memoryVisible ? "remember this" : "type the sequence you saw"
    if (type === "camera") return "camera"
    return ""
  }

  readonly property string promptText: {
    if (type === "math") return String(instance.prompt || "") + " = ?"
    if (type === "string") return String(instance.prompt || "")
    if (type === "memory") {
      if (memoryVisible) return String(instance.prompt || "")
      var n = instance.sequence ? instance.sequence.length : String(instance.expected || "").length
      var dots = []
      for (var i = 0; i < n; i++) dots.push("_")
      return dots.join(" ")
    }
    if (type === "camera") return "turn the light on"
    return ""
  }

  implicitWidth: Style.space(620)
  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(14)

    // ---- progress ----------------------------------------------------------
    Item {
      width: parent.width
      height: progressLabel.implicitHeight

      Text {
        id: progressLabel
        anchors.left: parent.left
        textFormat: Text.PlainText
        text: "challenge " + (root.rep + 1) + "/" + root.reps + "  ·  step " + (root.stepIndex + 1) + "/" + root.stepCount
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Text {
        anchors.right: parent.right
        textFormat: Text.PlainText
        text: root.completedSteps + "/" + root.totalSteps + " steps"
        color: root.theme.dim
        font.family: root.theme.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }

    Rectangle {
      width: parent.width
      height: Math.max(2, Style.space(3))
      radius: Math.min(Style.cornerRadius, height / 2)
      color: root.theme.border

      Rectangle {
        height: parent.height
        radius: parent.radius
        width: parent.width * Math.min(1, root.completedSteps / root.totalSteps)
        color: root.theme.accent
        Behavior on width { NumberAnimation { duration: 240; easing.type: Easing.OutCubic } }
      }
    }

    // ---- prompt ------------------------------------------------------------
    Card {
      width: parent.width
      height: promptColumn.implicitHeight + Style.space(22) * 2
      theme: root.theme
      danger: root.wrongFlash

      Column {
        id: promptColumn
        anchors.centerIn: parent
        width: parent.width - Style.space(22) * 2
        spacing: Style.space(10)

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: root.verb
          color: root.theme.dim
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.WrapAnywhere
          textFormat: Text.PlainText
          text: root.promptText
          color: root.type === "camera" ? root.theme.accent : root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.displayLarge * 1.6
          font.letterSpacing: root.type === "string" || root.type === "memory" ? Style.spaceReal(4) : 0
        }

        Text {
          width: parent.width
          visible: root.type === "camera"
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: "get up and switch the room light on. the step passes by itself once the light is bright enough.\nthe view is live only while this step is on screen."
          color: root.theme.dim
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }
    }

    // ---- input (text steps) ----------------------------------------------
    Card {
      id: inputCard
      visible: root.type !== "camera"
      width: parent.width
      height: inputRow.implicitHeight + Style.space(12) * 2
      theme: root.theme
      highlighted: !root.wrongFlash
      danger: root.wrongFlash
      opacity: root.host && root.host.inputLocked ? 0.4 : 1

      Row {
        id: inputRow
        anchors.left: parent.left
        anchors.leftMargin: Style.space(14)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(10)

        Text {
          textFormat: Text.PlainText
          text: ">"
          color: root.theme.accent
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.displayLarge
          font.bold: true
        }

        Text {
          id: draftText
          textFormat: Text.PlainText
          text: root.draft
          color: root.theme.foreground
          font.family: root.theme.fontFamily
          font.pixelSize: Style.font.displayLarge
        }

        Rectangle {
          id: caret
          anchors.verticalCenter: draftText.verticalCenter
          width: Math.max(2, Math.round(Style.font.displayLarge * 0.55))
          height: Math.round(Style.font.displayLarge * 1.1)
          color: root.theme.accent

          SequentialAnimation on opacity {
            running: inputCard.visible
            loops: Animation.Infinite
            NumberAnimation { to: 1; duration: 0 }
            PauseAnimation { duration: 530 }
            NumberAnimation { to: 0; duration: 0 }
            PauseAnimation { duration: 530 }
          }
        }
      }
    }

    // ---- camera: live view and light meter -----------------------------------
    Column {
      visible: root.type === "camera"
      width: Math.min(parent.width, Style.space(380))
      anchors.horizontalCenter: parent.horizontalCenter
      spacing: Style.space(12)

      CameraFrame {
        width: parent.width
        theme: root.theme
        url: root.host ? String(root.host.cameraFrame) : ""
        seq: root.host ? Number(root.host.cameraFrameSeq) : 0
        message: root.cameraMessage
        messageIsError: root.host ? String(root.host.cameraError) !== "" : false
      }

      LightMeter {
        width: parent.width
        theme: root.theme
        luma: root.host ? Number(root.host.cameraLuma) : -1
        threshold: root.host ? Number(root.host.lightThreshold) : 60
        progress: root.host ? Number(root.host.cameraProgress) : 0
        hold: root.host ? Number(root.host.cameraHold) : 0
        verdict: root.host ? String(root.host.cameraVerdict) : "unknown"
      }
    }

    // ---- status line -------------------------------------------------------
    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      textFormat: Text.PlainText
      text: {
        if (root.wrongFlash) return "not quite"
        if (root.capturing) return "capturing one frame..."
        if (root.outcomeText !== "") return root.outcomeText
        if (root.type === "camera") return "this step passes by itself"
        if (root.type === "memory" && root.memoryVisible) return "memorize; it hides in a moment"
        return "enter to submit  ·  ctrl+u to clear"
      }
      color: {
        if (root.wrongFlash || root.outcomeKind === "error") return root.theme.error
        if (root.outcomeKind === "success") return root.theme.success
        if (root.outcomeKind === "skip") return root.theme.accent
        return root.theme.faint
      }
      font.family: root.theme.fontFamily
      font.pixelSize: Style.font.body
    }
  }

  Theme { id: fallbackTheme }
}
