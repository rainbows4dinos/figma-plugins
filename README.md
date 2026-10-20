# Figma Plugins

Monorepo for my Figma plugins and the design system they share.

## Layout

| Path | Purpose |
|---|---|
| `plugins/style-stacks` | Style Stacks: a named clipboard for reusable styling properties |
| `packages/ui` | Shared design system (placeholder for now) |

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

1. Run `npm run watch -w style-stacks` to recompile `code.ts` on save (`ui.html` needs no build).
2. Close and re-run the plugin from **Plugins → Development** (or `Cmd+Option+P`) to pick up changes.

Re-import the manifest only when `manifest.json` itself changes or the folder moves.

## License

[MIT](LICENSE)
