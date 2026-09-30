// usage: node tools/run-detect.mjs <devServerUrl> <outDir> <image...>
import { chromium } from 'playwright';
import fs from 'fs';
const [base, outDir, ...images] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ ignoreHTTPSErrors: true });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`${base}/tools/detect.html`);
await p.waitForFunction(() => window.ready, null, { timeout: 180000 });
for (const img of images) {
  const r = await p.evaluate((u) => window.detect(u), `/${img}`);
  const name = img.split('/').pop().replace(/\.\w+$/, '');
  fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify(r));
  console.log(name, r.w, r.h, r.landmarks ? r.landmarks.length : 'NO FACE', JSON.stringify(Object.fromEntries(Object.entries(r.blendshapes).filter(([, v]) => v > 0.3))));
}
await b.close();
