import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const publicRoot = join(root, 'dashboard/public');
const dataRoot = join(root, 'data');
const host = process.env.LAUNCH_OS_HOST || '127.0.0.1';
const port = Number(process.env.LAUNCH_OS_PORT || 8798);

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  if (pathname === '/' || pathname === '/index.html') return join(publicRoot, 'index.html');
  if (pathname.startsWith('/data/')) return safeJoin(dataRoot, pathname.slice('/data/'.length));
  return safeJoin(publicRoot, pathname.slice(1));
}

function safeJoin(base, requestPath) {
  const normalized = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
  return join(base, normalized);
}

const server = createServer(async (request, response) => {
  try {
    const path = resolveRequestPath(request.url || '/');
    const info = await stat(path);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': contentTypes.get(extname(path)) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Launch OS dashboard listening on http://${host}:${port}`);
});
