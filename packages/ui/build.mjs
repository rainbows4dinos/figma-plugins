// Builds a plugin's ui.html from <plugin>/src/ui.html.
//   @@include(path)  inlines a text file; "@ui/..." resolves into packages/ui/src
//   @@asset(path)    inlines a file from the plugin folder as a data: URI
// Usage: node build.mjs <plugin-dir> [--watch]
import { readFileSync, writeFileSync, watch } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const shared = resolve(dirname(fileURLToPath(import.meta.url)), 'src');
const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

export function buildUi(pluginDir) {
  const root = resolve(pluginDir);
  const locate = p => p.startsWith('@ui/') ? resolve(shared, p.slice(4)) : resolve(root, p);
  const html = readFileSync(resolve(root, 'src/ui.html'), 'utf8')
    .replace(/@@include\(([^)]+)\)/g, (_, p) => readFileSync(locate(p), 'utf8').replace(/\n$/, ''))
    .replace(/@@asset\(([^)]+)\)/g, (_, p) => {
      const type = MIME[extname(p)];
      if (!type) throw new Error('Unsupported asset type: ' + p);
      return 'data:' + type + ';base64,' + readFileSync(locate(p)).toString('base64');
    });
  writeFileSync(resolve(root, 'ui.html'), html);
  return html.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.';
  const run = () => { try { console.log('ui.html built (' + buildUi(dir) + ' bytes)'); } catch (e) { console.error(e.message); } };
  run();
  if (process.argv.includes('--watch')) {
    let timer;
    for (const folder of [resolve(dir, 'src'), resolve(dir, 'assets'), shared]) {
      watch(folder, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(run, 100); });
    }
  }
}
