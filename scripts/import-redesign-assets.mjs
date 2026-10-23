// Extracts the eight production board assets from the exported Claude design HTML.
// Usage: node scripts/import-redesign-assets.mjs "/path/to/Chess Coach Redesign.html"
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('Pass the exported Chess Coach Redesign.html path.');

const source = readFileSync(input, 'utf8');
const manifestMatch = source.match(/<script type="__bundler\/manifest">\s*([\s\S]*?)\s*<\/script>/);
if (!manifestMatch) throw new Error('Top-level design manifest was not found.');
const rootManifest = JSON.parse(manifestMatch[1]);
const boardBundle = rootManifest['29147f70-535f-423e-ad9e-fdd89f81ac1d'];
if (!boardBundle) throw new Error('Board component bundle was not found.');

function bytes(entry) {
  const value = Buffer.from(entry.data, 'base64');
  return entry.compressed ? gunzipSync(value) : value;
}

const boardHtml = bytes(boardBundle).toString('utf8');
const nestedMatch = boardHtml.match(/<script type="__bundler\/manifest">\s*([\s\S]*?)\s*<\/script>/);
if (!nestedMatch) throw new Error('Board asset manifest was not found.');
const assets = JSON.parse(nestedMatch[1]);
const files = {
  'aether-board.webp': 'c7588f52-6931-4b83-b8a7-0ed5b5c200d6',
  'neon-board.webp': 'f9606725-3ea8-47fd-949a-5481005891bc',
  'wildwood-board.webp': 'f6df71b0-ff65-463a-9331-3658fb02caf7',
  'spell-board.webp': '8d0cde8b-dd72-4b9d-ba53-d9a1945ad6bc',
  'aether-pieces.webp': '7084ed2b-03c0-40af-88fa-90f6c360166f',
  'neon-pieces.webp': 'd817e818-32da-4415-aa97-4369c163270c',
  'wildwood-pieces.webp': '07cb6dba-f303-4b61-bd01-28fe2af8957c',
  'spell-pieces.webp': '39f7352b-6ef9-4c7d-8f57-320fc34bb76e'
};

const output = new URL('../src/board-styles/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const [name, id] of Object.entries(files)) {
  const entry = assets[id];
  if (!entry || entry.mime !== 'image/webp') throw new Error(`Missing WebP asset ${name}`);
  writeFileSync(new URL(name, output), bytes(entry));
  console.log(`Imported ${name}`);
}
