const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const parsedPort = parseInt(process.env.PORT, 10);
const PORT = (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) ? parsedPort : 4321;
const APP_ROOT_REAL = fs.realpathSync(__dirname);
const FORBIDDEN_PATHS = new Set(['/server.js', '/package.json', '/package-lock.json', '/start.bat']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

function launchBrowser(url) {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidateBrowsers = [
    // Google Chrome
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    // Microsoft Edge
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe'),
    // Brave
    path.join(programFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    path.join(localAppData, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')
  ];

  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(url)) {
    return;
  }

  for (const browserPath of candidateBrowsers) {
    if (browserPath && fs.existsSync(browserPath)) {
      const child = spawn(browserPath, [`--app=${url}`], {
        detached: true,
        stdio: 'ignore',
        shell: false
      });
      child.unref();
      return;
    }
  }

  // Fallback to default OS browser without shell string interpolation
  const fallback = spawn('cmd.exe', ['/c', 'start', '""', url], {
    detached: true,
    stdio: 'ignore',
    shell: false
  });
  fallback.unref();
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';

  // Block hidden dotfiles/directories and server/project configuration files
  const normalizedPath = path.posix.normalize(pathname.replace(/\\/g, '/'));
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  if (
    normalizedPath.includes('\0') ||
    pathSegments.some(seg => seg.startsWith('.')) ||
    FORBIDDEN_PATHS.has(normalizedPath.toLowerCase())
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Keep requests strictly inside the app directory (including symlink/junction resolution)
  const filePath = path.resolve(APP_ROOT_REAL, `.${normalizedPath}`);
  const relativePath = path.relative(APP_ROOT_REAL, filePath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let realFilePath;
  let stats;
  try {
    realFilePath = fs.realpathSync(filePath);
    if (!realFilePath.startsWith(APP_ROOT_REAL + path.sep) && realFilePath !== APP_ROOT_REAL) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    stats = fs.statSync(realFilePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
    return;
  }

  if (!stats.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(realFilePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stats.size,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };

  // Allow service workers to control root scope
  if (normalizedPath === '/sw.js') {
    headers['Service-Worker-Allowed'] = '/';
  }

  // Prevent aggressive browser caching during local desktop usage
  if (ext === '.html' || ext === '.js' || ext === '.json') {
    headers['Cache-Control'] = 'no-cache';
  }

  res.writeHead(200, headers);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(realFilePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal Server Error');
  });
  stream.pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${PORT}`;
    console.warn(`[EasyResume] Port ${PORT} already in use. Opening app at ${url}...`);
    launchBrowser(url);
  } else {
    console.error('[EasyResume] Server error:', err);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`EasyResume Desktop Server running at ${url}`);
  launchBrowser(url);
});

process.on('SIGINT', () => {
  console.log('\nShutting down EasyResume server...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
