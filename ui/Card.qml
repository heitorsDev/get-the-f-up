import QtQuick
import qs.Commons

// A bordered surface. Borders are always QML-drawn (1 px, Style.cornerRadius)
// and never unicode box-drawing glyphs: the two monitors run different scale
// factors and box glyphs break apart across that gap.
Rectangle {
  id: root

  property var theme: fallbackTheme
  property bool highlighted: false
  property bool danger: false
  property bool filled: true

  radius: Style.cornerRadius
  color: filled ? theme.surface : "transparent"
  border.width: 1
  border.color: danger ? theme.error : (highlighted ? theme.accent : theme.border)

  Theme { id: fallbackTheme }
}
