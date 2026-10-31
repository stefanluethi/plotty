# plotty

## What it is

plotty is a set of browser tools for making pen-plotter art. You design a piece, see exactly how it will plot, and export a file the plotter can run: layered SVG, or Klipper gcode with a pause at each pen change. Everything runs in the browser. There is no backend and no account, and settings are kept in the browser.

The first tool is **Topo**: Swiss topographic contour maps built from swisstopo elevation data, with lakes, rivers, GPX tracks, a frame and a title in single-stroke Hershey fonts. More tools will follow. Their subjects aren't decided yet, but they will share the same base: plot geometry, path optimizing, single-stroke fonts, the pen rack, the sheet preview and export.

- Platform: web (desktop browser, pointer and keyboard). Hosted on GitHub Pages.
- Mode for the tools themselves: **Operate**. You open plotty to finish a plot.

## Who it's for

Mainly the author. They run a DIY Klipper CoreXY plotter (590 × 850 mm bed, servo pen lifted through Z) and use plotty as their own studio tool. It's published openly, and others are welcome to use it, but they aren't the main audience. Design for someone who knows plotters, pens, paper sizes and gcode, and wants to get from an idea to plotted paper fast.

The usual session: pick a subject (an area, a track), tune it until the preview looks right at real pen width, check the time and pen changes, export, walk to the machine. People come back to the same settings often, so defaults and remembered state matter.

## What it must get right

1. **What you see is what plots.** The sheet preview is the source of truth: real sheet and bed proportions, real pen widths, pen-up moves when wanted. Nothing should look better or worse on screen than it does on paper.
2. **The machine is real.** Exported gcode must be safe and predictable: pen-up/down convention, pen order, pauses with clear prompts, staying inside the bed. Machine settings are editable rather than hard-coded.
3. **Fast iteration.** Changing a parameter shows its effect quickly. Long work runs off the main thread and reports its progress.
4. **Settings carry meaning, not raw numbers.** Settings are expressed in plotter terms (pen widths, passes, spacing in mm) and derived from each other where possible, e.g. the contour interval follows from pen width.

## Personality

A precise workshop instrument. Calm, exact and capable, like good machine software, or a Swiss national map: dense information that still reads clearly. Confidence comes from accuracy, not decoration. The artwork on the sheet is the most important thing on screen, and the controls support it.

## Anti-references

- **Generic SaaS dashboard:** card grids, gradients, purple accents, marketing gloss, empty "hero" chrome.
- **Cluttered CAD/CAM:** dense toolbars, nested modal dialogs, every option visible at once like Inkscape or a slicer. plotty shows the controls that matter and puts the rest behind a disclosure.

## Constraints

- Browser-only: no server, no build-time data, no API keys. Data has to be reachable over CORS (see the swisstopo note in `src/lib/geo/dem.ts`).
- Attribution: map and elevation data © swisstopo. Hershey fonts are credited as in the README.
- Gcode convention: `G1 Z0` pen down, `G0 Z5` pen up, `PAUSE` + `M117` at each pen change, pens plotted in rack order.
- Copy is short, plain English, in plotter vocabulary.
