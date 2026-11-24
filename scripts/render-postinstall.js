import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distIndex = path.join(rootDir, 'apps', 'web', 'dist', 'index.html');
const webSrc = path.join(rootDir, 'apps', 'web', 'src');

if (process.env.RENDER === 'true' && fs.existsSync(webSrc) && !fs.existsSync(distIndex)) {
  try {
    console.log('[SweldoSync] Render build detected with missing dist — compiling apps/web SPA...');
    execSync('npm run build --workspace=apps/web', { cwd: rootDir, stdio: 'inherit' });
  } catch (err) {
    console.warn('[SweldoSync] Build warning:', err.message);
  }
} else if (process.env.RENDER === 'true' && fs.existsSync(distIndex)) {
  console.log('[SweldoSync] Prebuilt apps/web/dist/index.html verified — skipping redundant 512MB Vite rebuild.');
}
