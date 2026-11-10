# Configura icons

Original MIT-licensed icon assets made for Configura from the user-supplied concept.

## Source

- Figma file: https://www.figma.com/design/XiCmRxhmvMzhClgdqWz15a/Configura-Icons?node-id=2-68
- Review frame: `2:68`
- Logo component: `2:7`
- 19 reusable vector components, including logo and 18 interface icons.
- Interface grid: 20 × 20 px; 1.5 px rounded strokes. The settings outline uses a 0.9 geometry scale.
- Foreground uses an aliased Figma color variable; web SVGs use `currentColor`.

The Figma library discovery was performed before drawing. Existing Simple Design System folder and sliders results were inspected; this set was drawn from original simple geometry to match the supplied reference and keep a consistent stroke weight. No third-party icon asset is included.

## Export pipeline

Each component was exported through Figma's `exportAsync({format: "SVG_STRING"})`. The exported foreground color was replaced with `currentColor` for application theming. The Windows app icon wraps the exported logo in a dark rounded square. Raster PNG and multi-size ICO are generated from that vector, with no online assets required at runtime.

For external SVGs, use CSS `mask-image` and `background: currentColor`, or inline the SVG. An `img` element does not inherit the page's current color.

## Component map

| File | Figma component |
| --- | --- |
| logo.svg | 2:7 |
| open-folder.svg | 2:10 |
| plus.svg | 2:13 |
| search.svg | 2:17 |
| chevron-down.svg | 2:20 |
| chevron-left.svg | 2:23 |
| close.svg | 2:26 |
| edit.svg | 2:29 |
| trash.svg | 2:32 |
| settings.svg | 2:36 |
| code.svg | 2:39 |
| sliders.svg | 2:44 |
| save.svg | 2:48 |
| undo.svg | 2:51 |
| download.svg | 2:54 |
| check.svg | 2:57 |
| file.svg | 2:61 |
| minimize.svg | 2:64 |
| maximize.svg | 2:67 |

## Visual validation

Reviewed the rendered 500 × 536 px Figma icon sheet. All icons are visible, consistently aligned and unclipped. The mark retains the three geometric panels of the concept.
