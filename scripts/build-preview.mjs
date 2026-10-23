// Wraps the artifact source in a full HTML document for local viewing.
// The Claude coach is unavailable locally; the page falls back to its built-in opponent.
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const source = readFileSync(new URL('../src/chess-coach.html', import.meta.url), 'utf8');
const body = source
  .replace('https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.js', './vendor/chess.js');
const appHead = `<meta name="theme-color" content="#2c6a4c">
<meta name="apple-mobile-web-app-title" content="Chess Coach">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png?v=1">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png?v=1">
<link rel="manifest" href="/manifest.webmanifest?v=1">`;
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${appHead}<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head><body>
${body}
</body></html>
`;
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
mkdirSync(new URL('../dist/vendor/', import.meta.url), { recursive: true });
mkdirSync(new URL('../dist/icons/', import.meta.url), { recursive: true });
mkdirSync(new URL('../dist/board-styles/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/index.html', import.meta.url), doc);
writeFileSync(new URL('../dist/preview.html', import.meta.url), doc);
copyFileSync(new URL('../node_modules/chess.js/chess.js', import.meta.url), new URL('../dist/vendor/chess.js', import.meta.url));
copyFileSync(new URL('../src/manifest.webmanifest', import.meta.url), new URL('../dist/manifest.webmanifest', import.meta.url));
for (const icon of ['apple-touch-icon.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png']) {
  copyFileSync(new URL(`../src/icons/${icon}`, import.meta.url), new URL(`../dist/icons/${icon}`, import.meta.url));
}
const boardAssets=['aether-board.webp','aether-pieces.webp','neon-board.webp','neon-pieces.webp','wildwood-board.webp','wildwood-pieces.webp','spell-board.webp','spell-pieces.webp'];
let artifact=source;
for(const asset of boardAssets){
  const input=new URL(`../src/board-styles/${asset}`,import.meta.url);
  copyFileSync(input,new URL(`../dist/board-styles/${asset}`,import.meta.url));
  const data='data:image/webp;base64,'+readFileSync(input).toString('base64');
  artifact=artifact.replaceAll(`/board-styles/${asset}`,data);
}
writeFileSync(new URL('../dist/artifact.html',import.meta.url),artifact);
console.log('Built standalone app and self-contained Artifact source in dist/');
