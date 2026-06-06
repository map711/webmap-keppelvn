import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const secret = process.env.BUILD_SECRET;
if (!secret) {
  console.error('ERROR: BUILD_SECRET not set in .env file');
  console.error('Please add BUILD_SECRET=your-secret to your .env file');
  process.exit(1);
}
// BUILD_SECRET becomes a filesystem dir and a deployed URL segment — keep it to
// safe chars so it can't escape dist/ (e.g. "../..") or break the S3 paths.
if (!/^[\w.-]+$/.test(secret)) {
  console.error(`ERROR: BUILD_SECRET contains invalid characters: ${JSON.stringify(secret)}`);
  console.error('Use only letters, digits, underscore, dot, or hyphen.');
  process.exit(1);
}

const secretDir = path.join(projectRoot, 'dist', secret);

try {
  // Create directory
  await fs.mkdir(secretDir, { recursive: true });

  // Copy and rewrite the demo gallery pages (the deployed product is the
  // gallery: a landing index + the engine-variant demos + their guide pages
  // under demo/).
  const htmlFiles = [
    'demo/index.html',
    'demo/bare.html',
    'demo/bare-doc.html',
    'demo/basic.html',
    'demo/basic-doc.html',
    'demo/api.html',
    'demo/api-doc.html',
    'demo/level.html',
    'demo/level-doc.html',
    'demo/focus.html',
    'demo/focus-doc.html',
    'demo/theme.html',
    'demo/theme-doc.html',
  ];

  for (const file of htmlFiles) {
    const sourcePath = path.join(projectRoot, file);
    const outputName = path.basename(file);
    let content = await fs.readFile(sourcePath, 'utf8');

    // Rewrite import paths from ./dist/... or ../dist/... to ../wayfinder-map.min.js.
    // The gallery lands under <secret>/, so the bundle one level up (../) maps to
    // the bucket-root wayfinder-map.min.js that deploy.js uploads. The demos'
    // ../datas/ refs resolve the same way (deploy uploads that dir to the bucket
    // root too).
    content = content.replace(
      /(?:\.\.\/|\.\/)dist\/wayfinder-map\.esm\.js/g,
      '../wayfinder-map.min.js'
    );

    await fs.writeFile(path.join(secretDir, outputName), content);
  }

  console.log(`✓ Deployment files created in dist/${secret}/`);
  console.log(`  - ${htmlFiles.map((file) => path.basename(file)).join('\n  - ')}`);
} catch (error) {
  console.error('ERROR: Failed to copy deployment files:', error.message);
  process.exit(1);
}
