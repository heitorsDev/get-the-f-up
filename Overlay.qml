import QtQuick
import Quickshell
import Quickshell.Wayland

Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false

  function open(payloadJson) { opened = true }
  function close() { opened = false }

  Variants {
    model: Quickshell.screens
    delegate: Component {
      PanelWindow {
        required property var modelData
        screen: modelData
        visible: root.opened
        color: "#000000"
        exclusionMode: ExclusionMode.Ignore
        WlrLayershell.namespace: "omarchy-sleep-mode"
        WlrLayershell.layer: WlrLayer.Overlay
        anchors { top: true; bottom: true; left: true; right: true }
      }
    }
  }
}
