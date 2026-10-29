import QtQuick
import qs.Commons

// The live camera frame, mirrored like a selfie view, in a black rounded box.
//
// The stream overwrites one file in place, so two images take turns: the
// hidden one reloads the file and is shown once it is ready. That avoids both
// flicker and any reliance on a changing URL to defeat the image cache.
//
// `message` is shown while there is nothing to draw (opening, or an error).
Rectangle {
  id: root

  property var theme: fallbackTheme
  property string url: ""
  property int seq: 0
  property string message: ""
  property bool messageIsError: false
  property real aspect: 0.75

  height: Math.round(width * aspect)
  radius: Style.cornerRadius
  color: "#000000"
  border.width: 1
  border.color: theme.border
  clip: true

  property bool showA: true

  onSeqChanged: {
    if (root.url === "") return
    var target = root.showA ? frameB : frameA
    target.source = ""
    target.source = root.url
  }

  Image {
    id: frameA
    anchors.fill: parent
    anchors.margins: 1
    visible: root.showA && status === Image.Ready
    fillMode: Image.PreserveAspectFit
    mirror: true
    cache: false
    asynchronous: true
    onStatusChanged: if (status === Image.Ready) root.showA = true
  }

  Image {
    id: frameB
    anchors.fill: parent
    anchors.margins: 1
    visible: !root.showA && status === Image.Ready
    fillMode: Image.PreserveAspectFit
    mirror: true
    cache: false
    asynchronous: true
    onStatusChanged: if (status === Image.Ready) root.showA = false
  }

  Text {
    anchors.centerIn: parent
    width: parent.width - Style.space(24)
    horizontalAlignment: Text.AlignHCenter
    visible: root.message !== ""
    textFormat: Text.PlainText
    text: root.message
    color: root.messageIsError ? root.theme.error : root.theme.dim
    font.family: root.theme.fontFamily
    font.pixelSize: Style.font.bodySmall
    wrapMode: Text.WordWrap
  }

  Theme { id: fallbackTheme }
}
