// Loopback-only production preview with a real nested deployment path for browser QA.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve('dist');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1:4174');
      if (url.pathname === '/hangar/qa-away') {
        response
          .writeHead(200, {
            'content-type': 'text/html',
            'cache-control': 'max-age=0,must-revalidate',
          })
          .end(
            '<!doctype html><title>Hangar return test</title><p>Navigation acceptance fixture</p>',
          );
        return;
      }
      if (!url.pathname.startsWith('/hangar/')) {
        response.writeHead(404).end();
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice('/hangar/'.length)) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await fs.readFile(file);
      response
        .writeHead(200, {
          'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        .end(body);
    } catch {
      response.writeHead(404).end();
    }
  })
  .listen(4174, '127.0.0.1', () => console.log('Hangar QA preview: http://127.0.0.1:4174/hangar/'));
