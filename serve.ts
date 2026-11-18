// Solmara — a small static file server for local play.
//
// Run it from the repository root and open the game in a desktop browser:
//
//   node serve.ts
//   -> http://localhost:8080
//
// Pass --port <n> to listen somewhere else. It only ever serves files from
// game/ next to this file, answers with the right content type for the
// kinds of files a browser game uses, and says no to any request that
// tries to climb out of that folder. It is a development convenience, not
// a server for the open internet.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const cliArgs = process.argv.slice(2);
const portFlag = cliArgs.indexOf('--port');
const wantedPort = portFlag === -1 ? 8080 : Number(cliArgs[portFlag + 1]);
const port =
  Number.isInteger(wantedPort) && wantedPort > 0 && wantedPort < 65536
    ? wantedPort
    : 8080;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
  // This server only reads files; anything that is not a plain fetch for
  // a file gets turned away rather than answered.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end('method not allowed');
    return;
  }

  const requestUrl = new URL(request.url ?? '/', 'http://localhost');

  let pathInsideGame: string;
  try {
    pathInsideGame = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathInsideGame.endsWith('/')) pathInsideGame += 'index.html';

  const target = resolve(join(gameRoot, normalize(pathInsideGame)));
  const insideGame = target === gameRoot || target.startsWith(gameRoot + sep);
  if (!insideGame) {
    response.writeHead(403).end('forbidden');
    return;
  }

  let fileSize: number;
  try {
    const info = statSync(target);
    if (!info.isFile()) throw new Error('not a file');
    fileSize = info.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }

  response.writeHead(200, {
    'content-type':
      CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': fileSize,
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Solmara is served at http://localhost:${port}`);
});
