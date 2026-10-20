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

## License

[MIT](LICENSE)
