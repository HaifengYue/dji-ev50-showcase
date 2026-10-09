// Build-only URL aliases for existing bookmarks and consumers. Source assets have one owner.
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../public/skytrans/', import.meta.url));
const alias = fileURLToPath(new URL('../dist/transwing/', import.meta.url));
cpSync(source, alias, { recursive: true });
console.log('Built legacy asset URL aliases from the canonical SkyTrans assets');
