<img src="assets/style-stacks-thumb.svg" alt="" width="64" height="64">

# Style Stacks

A Figma plugin that works as a persistent, named clipboard for reusable styling properties. Save a layer's styling as a named *class*, then apply it to any other layer without touching its size, position, or contents.

Classes are reusable recipes, not live links: updating a class does not change layers styled earlier.

## Features

- **Save** a class from the selected layer, choosing which property groups to include:
  - Fills
  - Strokes (weight, alignment, dash)
  - Corner radii
  - Effects
  - Auto Layout (direction, padding, spacing, alignment)
- **Apply** a class to one or many selected layers with one click. Only the saved groups are applied; everything else is preserved.
- **Manage** classes: rename, update from the current selection, delete.
- Preserves **variable bindings** and **native styles** where the Plugin API allows, with saved literal values as a fallback.
- Classes are stored in the Figma document (plugin data), so they persist when the file is reopened. No accounts, no network access, no dependencies at runtime.

## Development

From the repo root, run `npm install`, then:

```sh
npm run build -w style-stacks       # compile code.ts -> code.js
npm run watch -w style-stacks       # rebuild on change
npm run typecheck -w style-stacks
```

To load the plugin in Figma: **Plugins → Development → Import plugin from manifest…** and select `plugins/style-stacks/manifest.json`.

## Project layout

| File | Purpose |
|---|---|
| `code.ts` | Plugin logic: serialization, storage, capture, application |
| `ui.html` | Plugin UI (HTML, CSS, and JS in one file) |
| `manifest.json` | Figma plugin manifest |
| `assets/` | Icon (SVG and PNG) used in the UI, README and Community listing |
| `product-brief.md` | Original brief and implementation notes |

## Limitations

- Auto Layout is captured only from non-grid frames, and skipped on hug-sized targets to preserve their sizing.
- Mixed text fills, shader/video paints, and shader effects are not captured.
- Locked layers and layers inside instances are skipped.

## License

[MIT](../../LICENSE)
