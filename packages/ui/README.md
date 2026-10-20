# @figma-plugins/ui

Shared design system for the plugins in this repo, plus the UI build script.

- `src/tokens.css`: shared design tokens (`--ds-*`)
- `src/shims.js`: browser shims for the plugin iframe
- `build.mjs`: builds a plugin's single-file `ui.html` from its `src/ui.html`. See the root README for the `@@include` and `@@asset` directives.

Plugin UIs must ship as one inlined HTML file, so everything here is compiled into each plugin at build time and never loaded at runtime.
