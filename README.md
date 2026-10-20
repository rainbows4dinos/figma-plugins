# Figma Plugins

Monorepo for my Figma plugins and the design system they share.

## Layout

| Path | Purpose |
|---|---|
| `plugins/style-stacks` | Style Stacks: a named clipboard for reusable styling properties |
| `packages/ui` | Shared design system (tokens, shims) and the UI build script |

## Development

Requires Node.js. Install once at the repo root:

```sh
npm install
npm run build        # build every plugin
npm run typecheck
```

Each plugin has its own `manifest.json`. In Figma, use **Plugins → Development → Import plugin from manifest…** and pick the plugin's manifest. To work on a single plugin: `npm run watch -w style-stacks`.

### Iterating

Import a plugin's manifest once; Figma keeps pointing at the folder. Then:

1. Run `npm run watch -w style-stacks`. It rebuilds `ui.html` (from `src/`) and `code.js` (from `code.ts`) on save.
2. Close and re-run the plugin from **Plugins → Development** (or `Cmd+Option+P`) to pick up changes.

Re-import the manifest only when `manifest.json` itself changes or the folder moves.

`ui.html` and `code.js` are generated, so run `npm run build` once after cloning.

### How the UI is built

Each plugin's UI source lives in `plugins/<name>/src/` (`ui.html`, `ui.css`, `ui.js`). `packages/ui/build.mjs` inlines everything into the single `ui.html` Figma requires:

- `@@include(src/ui.css)` inlines a text file. `@@include(@ui/tokens.css)` pulls from the shared design system in `packages/ui/src/`.
- `@@asset(assets/icon.svg)` inlines a file as a `data:` URI.

## License

[MIT](LICENSE)
