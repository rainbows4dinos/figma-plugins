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

## Library classes

Design system teams can share classes through a Figma library, the same way they share components.

1. **Save to library.** In the library file, check **Add to library** when saving a class, or use **Edit → Add to library** on an existing one. Then publish the library.
2. **Pick and apply.** In any file that uses the library, its classes appear under **From libraries**. Applying one always uses the latest published version, with no library update to accept.
3. **Portability warning.** Before a class goes into the library, Style Stacks warns about anything that won't work in other files: variables or styles that are hidden or not yet published, raw values that match a token but aren't linked to it, and image or pattern fills.

Library classes can only be edited in their library file.

Under the hood, each library class is a string variable in a **Style Stacks** variable collection in the library file. Its value is the class recipe as JSON, its scopes are empty so it stays out of property pickers, and its description is `style-stacks:class v2` so sync tooling can skip it. Consumer files find classes with the team library API and resolve tokens and styles by published key.

## Development

From the repo root, run `npm install`, then:

```sh
npm run build -w style-stacks       # build ui.html and compile code.ts -> code.js
npm run watch -w style-stacks       # rebuild on change
npm run typecheck -w style-stacks
```

To load the plugin in Figma: **Plugins → Development → Import plugin from manifest…** and select `plugins/style-stacks/manifest.json`.

## Project layout

| File | Purpose |
|---|---|
| `code.ts` | Plugin logic: serialization, document and library storage, portability checks, capture, application |
| `src/ui.html`, `src/ui.css`, `src/ui.js` | Plugin UI source, built into the generated `ui.html` |
| `manifest.json` | Figma plugin manifest |
| `assets/` | Icon (SVG and PNG) used in the UI, README and Community listing |
| `product-brief.md` | Original brief and implementation notes |

## Limitations

- Auto Layout is captured only from non-grid frames, and skipped on hug-sized targets to preserve their sizing.
- Mixed text fills, shader/video paints, and shader effects are not captured.
- Locked layers and layers inside instances are skipped.
- Layers styled with a library class don't update when the class changes. Token-bound properties still follow token changes.
- The **Style Stacks** collection shows up in consumer files' library list and Variables panel.

## License

[MIT](../../LICENSE)
