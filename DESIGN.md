# plotty design system

This file describes what ships in Topo (`src/app.css` and `src/lib/ui/`). Every plotty tool uses it. When this file and the code disagree, the code wins: update this file to match.

## The idea

**The software is part of the machine.** The interface is the plotter's own frame, in anodized aluminium greys with thin machined rules. It sits around a dark well, and the bed and the paper sit in that well. The paper is the only bright surface on screen, so the artwork always reads first. One accent colour, Swiss-map lake blue, marks the things that are live: the current selection, focus, the area frame, the origin, progress, the main action. Everything else stays neutral.

Mode: **Operate**. Density is fine, clutter is not. Settings are grouped into collapsible sections and expressed in plotter units, and anything rarely needed stays collapsed.

## Colour

All colours are tokens on `:root` in `src/app.css`. The canvas reads them at draw time through `getComputedStyle`, so the sheet view and the HTML share one palette. Dark only (`color-scheme: dark`); there is no light theme.

| Token | Value | Role |
|---|---|---|
| `--frame` | `#2b3035` | Panels, header, status bar, popovers. The machine frame. |
| `--frame-2` | `#343a40` | Inputs and raised controls, the selected segment |
| `--frame-3` | `#3e454c` | Hover on controls and list rows, progress track |
| `--rule` | `#444c54` | Structural borders: panel edges, header/status rules, button borders |
| `--rule-soft` | `#383f45` | Section dividers, control borders at rest, status cell separators |
| `--well` | `#1f2327` | The workspace behind the bed, segmented-control tray, track overlay |
| `--bed` | `#2e3439` | Plotter bed in the sheet view |
| `--bed-grid` / `--bed-grid-major` | `#384047` / `#48525b` | Bed grid lines, minor and major |
| `--paper` | `#fbfbf8` | The sheet. Warm white, the brightest thing on screen. |
| `--ink` | `#e8eae5` | Main text (11:1 on frame) |
| `--ink-2` | `#a8b0b4` | Labels, secondary text, inactive tabs (6:1) |
| `--ink-3` | `#939da4` | Hints, status-bar keys, ruler labels, chevrons (4.8:1 on frame). Inside `--frame-2` controls it drops to 4.2:1, so units, list details and pen order numbers use `--ink-2` there. |
| `--lake` | `#8cc7e8` | The one accent: focus, active, selection, primary button, origin, progress |
| `--lake-hover` | `#a5d4ee` | Primary button hover |
| `--lake-dim` | `rgba(140,199,232,.16)` | Accent fill behind active states (toggle track) |
| `--lake-wash` | `rgba(140,199,232,.06)` | Fill inside the map frame |
| `--on-lake` | `#10212c` | Text on lake fills (9:1) |
| `--travel` | `#d0428a` | Pen-up moves on the sheet |
| `--scrim` | `rgba(31,35,39,.8)` | Backing for labels and overlays floating over the map or sheet |
| `--dim` | `rgba(20,24,28,.45)` | Map outside the frame |
| `--shadow-float` / `--shadow-pop` | see `app.css` | Floating notes / popovers |
| `--warn` | `#e3b75a` | Warnings in panel copy |
| `--danger` | `#ec8a7c` | Errors, destructive actions |

Rules:
- **Lake blue is for meaning, not decoration.** It always means focused, active, selected or "this will happen". Don't use it for headings, icons or decorative fills.
- **Neutral greys are slightly cool and slightly green.** Stay within this ramp; don't introduce pure `#000`/`#fff` greys.
- **Pen colours belong to the user.** Pen swatches, nibs and strokes on the sheet use each pen's own `color`. UI states must never depend on pen colours.
- Text on the primary button is `--on-lake`, a deep lake ink.
- The sheet's travel (pen-up) overlay is `--travel` magenta, dashed. It's chosen to clash with any likely pen ink so it can never be mistaken for a drawn line.
- Map overlays dim the area outside the frame with `--dim`. Floating labels use `--scrim` as their backing. No raw colour values in components: add a token instead.

## Typography

One family: **Archivo Variable** with its width axis (`@fontsource-variable/archivo/wdth.css`), falling back to `system-ui`. Numbers are always tabular (`font-variant-numeric: tabular-nums` on `:root`). Monospace (`ui-monospace, 'JetBrains Mono'`) appears only in raw gcode text areas.

The width axis does the work a second typeface would otherwise do. Condensed widths mark labels and metadata; normal width is for values and content.

| Use | Size | Weight | Width |
|---|---|---|---|
| Base / values / body | 13px, lh 1.4 | 400 | 100% |
| Section title | 13.5px | 620 | 92% |
| Button, tab | 13px | 550 | 100% |
| Pen name | 13px | 550 | 88% |
| Field label (`.label`) | 13px | 500 | 78%, +0.01em tracking |
| Tool name next to the wordmark | 13px | 500 | 80% |
| Hint (`.hint`), meta, units, status bar | 12px | 400 | 100% (status keys at 78%) |
| List detail | 11.5px | 400 | 100% |
| Pen order number | 11px | 400 | 75% |
| Bed axis labels (canvas) | 11px | 500 | 100% |
| `kbd` | 10.5px | 400 | 100% |

The **wordmark** is "plotty" drawn live as a path in Hershey Script 1, the same single-stroke font the plotter writes titles in (`Wordmark.svelte`). The product's name is literally written in plotter lines. Keep it that way: never replace it with a set webfont. The tool name sits after it, condensed and in `--ink-2`, behind a thin rule.

Copy is sentence case, short and plain, in plotter vocabulary ("Pen-up", "Plot time", "Download gcode"). No all-caps labels.

## Shape and depth

- Radii: `--r-sm` 3px for controls, buttons, inputs and lists; `--r-md` 6px for pen chips, popovers, notes and the view switch. Inner segments use 2px or 4px. Pill chips (`border-radius: 12px`) are only used for preset choices.
- Borders are 1px hairlines. Depth comes from the colour steps well → frame → frame-2, not from shadows.
- Shadows only appear on things that float above the work: popovers (`--shadow-pop`), the sheet note (`--shadow-float`) and the paper sheet itself on the canvas (blur 18, y 4). Panels and controls have none.
- No gradients, no glass, no textures. The "aluminium" is flat colour.

## Layout

A fixed app grid fills the viewport (`App.svelte`):

```
┌─────── header 52px: wordmark · designs · Map|Sheet · pen rack · export ───────┐
│ left 272px   │            center: map or sheet (well)             │ right 300px │
│ area, terrain│                                                    │ layers,     │
│ machine…     │                                                    │ tracks, text│
└──────────── status 28px: terrain · interval · source … ink · pen-up · time ───┘
```

- Up to 1100px the side panels shrink to 240/270px and the `kbd` hints are hidden.
- Up to 900px everything stacks into one column: header (wrapping, with the pen rack on its own wrapping row), the view at 70vh, left panel (area first), right panel, then the status bar. The window scrolls; a vertical swipe on the sheet scrolls the page, a horizontal drag pans the sheet.
- Panels scroll on their own with a thin `--rule`-coloured scrollbar.
- Tools float over the center view at 12px insets, top left. Help text sits bottom left.
- Spacing uses small, fixed steps: 4 / 6 / 7 / 8 / 10 / 12 / 16px. A section header has 11px × 12px padding; its body is indented 30px on the left so it lines up past the chevron, with a 7px gap between rows.

## Controls

Two shared classes in `app.css`, plus Svelte components in `src/lib/ui/`.

- **`.ctl`**: the base input look. `--frame-2` fill, `--rule-soft` border, 26px high, 7px side padding. On hover the border becomes `--rule`; on focus it becomes `--lake` with a 1px lake ring (inset, no offset).
- **`.btn`**: 28px high, 11px side padding, weight 550, `--rule` border, `--frame-3` on hover.
  - `.primary`: lake fill with deep-lake text. Use it once per screen, for the action that sends work to the machine ("Download gcode").
  - `.ghost`: transparent, `--ink-2` text, shown as a control only on hover.
  - Disabled: 45% opacity.
- **Field** (`Field.svelte`): label on the left, a right-aligned numeric box (92px, or 120px when `wide`) with a unit suffix in `--ink-3`. **Drag the label sideways to scrub** (Shift is finer per pixel and ×10 per step). Arrow keys step, Shift+arrow ×10. Commas and Swiss apostrophes are accepted when typing.
- **Select / PenPick**: label left, control in a column up to 140px. PenPick shows a dot in the pen's colour, sized by its width.
- **Toggle**: a 30×16 switch; when on, the track is lake-dim with a lake border and the knob is lake. Used for on/off settings inside a section.
- **Section** (`Section.svelte`): a collapsible group with a chevron, title, optional right-aligned meta and an optional enable checkbox (a 14px square that fills with lake). A disabled section turns its title `--ink-3` and its body to 55% opacity, but stays editable.
- **Segmented switch**: a tray in `--well` (or `--frame` over the map) holding segments. The selected segment is raised to `--frame-2`/`--frame-3` with an inset rule. Used for Map|Sheet (buttons with `aria-pressed`) and the base map choice (radio group).
- **Toggle button**: a `.btn` with `.on` (lake border and text) and `aria-pressed`, used for view options on a floating toolbar ("Pen-up moves"). Don't put native checkboxes there.
- **Pen rack** (`PenRack.svelte`): pen chips in the header, in plotting order. Each shows its order number, a nib swatch (its width scales with pen width), the name (cut off with an ellipsis after 14ch) and the width. The active chip has a lake border. Clicking a chip opens a popover editor under it, kept inside the window. Focus moves to the Name field and returns to the chip on Escape, ×, or a click outside.
- **Design menu** (`DesignMenu.svelte`): sits right after the tool name and shows the current design's name (or "Designs"). A small `--ink-2` dot means it changed since it was saved, and a lake "Saved" appears briefly after saving. The popover under it follows the pen editor's pattern: a name box with Save (it reads "Replace" when the name belongs to another saved design), one notice line with an Undo button for opening and deleting, a list of saved designs (40px paper preview, name, scale and sheet, date; the current one in lake) and file buttons below a rule. Ctrl+S saves without opening it once the design has a name.
- **Chip**: 24px pill used for presets (e.g. paper sizes). When selected, its border and text turn lake.
- **Status bar**: one row of cells separated by `--rule-soft`, each with a condensed `--ink-3` key followed by its value. The left cells can be replaced by one message, in priority order: an error in `--danger` (`role="alert"`), the sheet sitting off the bed in `--warn`, or a non-blocking warning in `--warn` (storage full, font missing). While drawing, "Drawing" shows in lake. The bar is deliberately **not** a live region, since its numbers change on every scrub step.
- **Drop target**: a 2px dashed lake border inset 12px over the view, on a dark see-through backing.

Click targets are at least 24 × 24 px, including the section on/off box, the track visibility box and the × buttons. The box can be drawn smaller inside a larger hit area.

Screen readers: field units are spoken after the label through a `.sr-only` span ("Line width, mm"), and search results are announced in a status line. Use `.sr-only` from `app.css` for text that only screen readers should hear.

Focus: every interactive element shows a lake focus state. Use `:focus-visible` with a 2px outline (1px offset); controls with a `.ctl` box use the border-and-ring version instead. Custom checkboxes and switches put the ring on their visible box.

## Sheet and map rendering

- **Sheet view** (canvas): `--well` background, the `--bed` rectangle with a grid every 10 mm and a major line every 50 mm, and the machine origin marked by a lake L. Ruler labels in `--ink-3` with a `--well` halo are drawn last. They stay on the window edge when the bed edge is out of view, and skip the band under the floating toolbar. The paper rectangle carries a soft shadow and a label in `--ink-2` ("297 × 420 mm at X… Y…"). Lines are drawn at their **real pen width in mm** with round caps and joins, at 94% opacity. Only when a nib becomes thinner than 0.6 device px does it get a minimum width and fade.
- **Map view** (MapLibre over swisstopo): the base map is muted so the frame stands out. The grey map is inverted into a dark map; colour and aerial maps are dimmed. The area frame is a lake outline over a 6% lake fill, with square handles filled in `--well`. Everything outside the frame is dimmed. Attribution stays visible, restyled to fit the dark UI.

## Motion

Minimal and functional: about 120ms transitions on chevron rotation and toggle state, and 200ms on progress bar width. Nothing animates on load. `prefers-reduced-motion` turns off all transitions and animations.

## Icons

Almost none. Inline SVG drawn with strokes (chevron at 1.4px stroke) and text glyphs (`×`). The favicon is three lake-blue contour strokes on a frame-grey rounded square. If a tool needs icons, draw them as single strokes with round caps, like a pen would.

## Adding a new tool

- Reuse the shell: header (wordmark + tool name, design menu, view switch, pen rack, export), left/right panels of `Section`s, center view, status bar.
- The sheet view and pen rack are shared and should look the same in every tool. Only the left and right panel contents change.
- Use the existing tokens and controls. A new control should be built from `.ctl`/`.btn` and these states, not styled separately.
- Status bar cells should report what matters before plotting (ink length, pen-up length, lifts, plot time) plus the tool's own key numbers.
- Export goes through `engine.idle()` so the file always matches the current settings. Gcode export stays disabled while `sheetOnBed()` is false.

## Known gaps

- The paper's drop shadow on the canvas is still a literal (`rgba(0,0,0,.45)`, blur 18), since the canvas can't read a CSS `box-shadow` token.
