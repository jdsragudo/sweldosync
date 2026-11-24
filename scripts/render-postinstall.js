import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const webSrc = path.join(rootDir, 'apps', 'web', 'src');

if (process.env.RENDER === 'true' && fs.existsSync(webSrc)) {
  try {
    console.log('[SweldoSync] Render build detected — compiling apps/web SPA...');
    execSync('npm run build --workspace=apps/web', { cwd: rootDir, stdio: 'inherit' });
  } catch (err) {
    console.warn('[SweldoSync] Build warning (falling back to prebuilt dist if present):', err.message);
  }
}
