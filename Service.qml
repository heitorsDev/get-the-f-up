import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  IpcHandler {
    target: "sleep-mode"
    function status(): string { return "{}" }
  }
}
