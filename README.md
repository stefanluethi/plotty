# plotty

Browser tools for making pen-plotter art and sending it straight to the plotter as gcode.

## Topo

Draws Swiss topographic contour lines for any area you pick on the swisstopo map.

- **Pick an area**: search a place or drag the frame on the map. Drag a corner to change the scale. The frame always has the proportions of your sheet.
- **Contours**: the interval is chosen from your pen width, so lines keep a set number of pen widths apart. In steep terrain, intermediate lines are dropped instead of merging into black, and every Nth line can be drawn heavier with extra passes.
- **Lakes and rivers** from swisstopo vector data, **GPX tracks** (import or drop a file) with their own pen and width, plus an optional break in the other lines around the track. Also a **frame** and a **title** in single-stroke Hershey fonts.
- **Sheet view** shows the plotter bed to scale with the sheet where it will sit, every line drawn at its real pen width, and optionally the pen-up moves.
- **Export**: layered SVG (one Inkscape layer per pen), or gcode for Klipper. The gcode lowers the pen with `G1 Z0` and raises it with `G0 Z5` (servo via the `G0`/`G1` macros). Pens are plotted in rack order, with `PAUSE` and an `M117` message at each pen change. All of this can be edited under Machine.

### Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Settings are saved in the browser.

### Data

- Elevation: [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d) (2 m, used for small areas) and swissALTIRegio (10 m, used for large ones), streamed as cloud-optimised GeoTIFFs from data.geo.admin.ch.
- Base map, place search, lakes and rivers: © swisstopo.

### Fonts

The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821. The SVG font files come from [hersheytext](https://gitlab.com/oskay/hershey-text) by Windell H. Oskay (Evil Mad Scientist); see `public/fonts/LICENSE-hersheytext.txt`.
