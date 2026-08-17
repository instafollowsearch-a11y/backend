import { execFileSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data');
const OUT_FILE = path.join(OUT_DIR, 'GeoLite2-City.mmdb');

const licenseKey = String(process.env.MAXMIND_LICENSE_KEY || '').trim();
if (!licenseKey) {
  console.log('MAXMIND_LICENSE_KEY unset — skip GeoLite2 download (geoip-lite fallback).');
  process.exit(0);
}

const url =
  'https://download.maxmind.com/app/geoip_download' +
  `?edition_id=GeoLite2-City&license_key=${encodeURIComponent(licenseKey)}&suffix=tar.gz`;

const tmpDir = path.join(os.tmpdir(), `geolite2-${Date.now()}`);
const tarPath = path.join(tmpDir, 'GeoLite2-City.tar.gz');
mkdirSync(tmpDir, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const download = (src, dest) =>
  new Promise((resolve, reject) => {
    const follow = (current, hops = 0) => {
      if (hops > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      https
        .get(current, (res) => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            res.resume();
            follow(loc, hops + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`GeoLite2 download failed: HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          pipeline(res, createWriteStream(dest)).then(resolve).catch(reject);
        })
        .on('error', reject);
    };
    follow(url);
  });

const findMmdb = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      const nested = findMmdb(full);
      if (nested) return nested;
    } else if (name.name.endsWith('GeoLite2-City.mmdb')) {
      return full;
    }
  }
  return null;
};

try {
  console.log('Downloading GeoLite2-City…');
  await download(url, tarPath);
  execFileSync('tar', ['-xzf', tarPath, '-C', tmpDir]);
  const mmdb = findMmdb(tmpDir);
  if (!mmdb || !existsSync(mmdb)) {
    throw new Error('GeoLite2-City.mmdb not found in archive');
  }
  copyFileSync(mmdb, OUT_FILE);
  console.log(`Wrote ${OUT_FILE}`);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
