# plotty

Browser tools for making pen-plotter art and sending it straight to the plotter as gcode.

## Topo

Draws Swiss topographic contour lines for any area you pick on the swisstopo map.

- **Pick an area**: search a place or drag the frame on the map. Drag a corner to change the scale while the opposite corner stays put, so an edge lands exactly where you drop it. The frame always has the proportions of your sheet.
- **Contours**: the interval is chosen from your pen width, so lines keep a set number of pen widths apart. In steep terrain, intermediate lines are dropped instead of merging into black, and every Nth line can be drawn heavier with extra passes.
- **Relief shading** brings back the 3D look of a shaded map, lit from the northwest by default. Three optional layers can be combined: *illuminated contours* (Tanaka: extra passes where a slope turns away from the light, with the lit side thin, left out or in a second pen such as a white pen on toned paper), *shadow hatching* (1–4 tones of parallel and cross-hatched lines on slopes darker than flat ground), and *hachures* (short downhill strokes in rows, as on the Dufour and Siegfried maps, heavier in shade or on steep ground; strokes can be joined along a row to save pen lifts).
- **Roads** (motorways, main roads with extra passes, local roads, farm tracks), **paths and trails** by their signposted grade (yellow hiking, white-red-white mountain, white-blue-white alpine, unmarked; solid or dashed) and **railways and lifts**, all from the swisstopo base map vector tiles.
- **Forest** (edges, hatching or tree symbols), **glacier edges**, **buildings** (outlined or filled), **boundaries** (national, canton, district, municipality, parks; solid or dashed) and **labels** for peaks with heights, places and spot heights, placed without overlaps and with other lines broken around them. Contours on glaciers and rock can go to their own pens, as on Swiss maps. Hatched lakes, forest and buildings can use plain lines, cross-hatching, staggered dashes, waves or zigzags, each with its own spacing, angle and pattern settings.
- **Lakes and rivers** from swisstopo vector data, **GPX tracks** (import or drop a file) with their own pen and width, plus an optional break in the other lines around the track. Also a **frame** and a **title** in single-stroke fonts: 18 Hershey and EMS faces, from plain sans and serif to script and gothic. The Medium and Bold Hershey faces draw each stroke two or three times over for weight. Fonts are fetched only once a title or label uses them.
- **Smoothing and joins** (under Lines): map lines (rivers, lake shores, roads, paths, railways, boundaries, forest and glacier edges) and GPS tracks can be smoothed by a distance on paper, without breaking junctions. Lines of one pen whose ends nearly touch are drawn as one stroke, lines are ordered to keep pen-up moves short, and loops start where the pen already is.
- **Sheet view** shows the plotter bed to scale with the sheet where it will sit, every line drawn at its real pen width, and optionally the pen-up moves.
- **Designs**: save named designs in the browser (with a small preview of each), or save them to a `.plotty.json` file to keep or share. Open a file with the Designs menu or drop it on the window. A design holds everything except the machine settings, so opening one never moves the sheet on your bed. Ctrl+S saves the current design; opening or deleting one can be undone.
- **Export**: layered SVG (one Inkscape layer per pen), or gcode for Klipper. The gcode lowers the pen with `G1 Z0` and raises it with `G0 Z5` (servo via the `G0`/`G1` macros). Pens are plotted in rack order, with `PAUSE` and an `M117` message at each pen change. All of this can be edited under Machine.

### Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Settings are saved in the browser.

### Deploy

`.github/workflows/pages.yml` builds the site and publishes it to GitHub Pages on every push to `main` (or `master`). It can also be started by hand from the Actions tab. One-time setup: in the repository on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**. The site then appears at `https://<user>.github.io/<repo>/`.

### Data

- Elevation: [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d) (2 m, used for small areas) and swissALTIRegio (10 m, used for large ones), streamed as cloud-optimised GeoTIFFs from data.geo.admin.ch.
- Base map, place search, lakes and rivers: © swisstopo.

### Fonts

The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821. The SVG font files come from [hersheytext](https://gitlab.com/oskay/hershey-text) by Windell H. Oskay (Evil Mad Scientist); see `public/fonts/LICENSE-hersheytext.txt`. The EMS fonts by Sheldon B. Michaels are derived from open fonts and licensed under the SIL Open Font License 1.1 (`public/fonts/LICENSE-OFL.txt`); each SVG file names its original font and designer.
