import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_REGION', 'DO_SPACES_BUCKET', 'BUILD_SECRET'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Error: ${name} is not set in .env`);
    process.exit(1);
  }
}

const { DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_REGION, DO_SPACES_BUCKET, BUILD_SECRET } = process.env;
const ENDPOINT = `https://${DO_SPACES_REGION}.digitaloceanspaces.com`;

const env = {
  ...process.env,
  AWS_ACCESS_KEY_ID: DO_SPACES_KEY,
  AWS_SECRET_ACCESS_KEY: DO_SPACES_SECRET,
};

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env });
}

// Check for aws CLI
try {
  execSync('command -v aws', { stdio: 'ignore' });
} catch {
  console.error('Error: aws CLI is required. Install it: brew install awscli');
  process.exit(1);
}

// Build
console.log('Building...');
run('npm run build');

// Upload secret folder (the demo gallery HTML pages).
console.log(`\nSyncing dist/${BUILD_SECRET}/ to s3://${DO_SPACES_BUCKET}/${BUILD_SECRET}/ ...`);
run(
  `aws s3 sync "dist/${BUILD_SECRET}/" "s3://${DO_SPACES_BUCKET}/${BUILD_SECRET}/"` +
  ` --endpoint-url "${ENDPOINT}"` +
  ` --acl public-read` +
  ` --cache-control "public, max-age=0"` +
  ` --delete`
);

// Publish the split map data to the deploy bucket's root `/datas/` — this drives
// the demo gallery. The pages load data same-origin via
// `../datas/maps_SGC_v001.json.gz` + `../datas/datas_SGC_v001.json.gz`, which
// resolve to THIS bucket's root from inside <secret>/ — so the data must live
// here, not only on the CMS dev bucket (keppelvn-data-dev.indoorcms.com). The CMS
// publishes to that separate origin; it does NOT populate this bucket, so without
// this step `/datas/…` 403s.
//
// We deploy the local `datas/` mirror AS-IS — refreshing it is a deliberate,
// separate `npm run data:pull` step so you control which data version ships.
// Guard against shipping an empty/absent mirror (which would 403 every demo).
const dataDir = path.join(projectRoot, 'datas');
const dataFiles = (existsSync(dataDir) ? readdirSync(dataDir) : [])
  .filter((name) => /^(?:maps|datas)_.*\.json\.gz$/.test(name));
if (dataFiles.length === 0) {
  console.error('Error: no datas/{maps,datas}_*.json.gz to deploy.');
  console.error('Run `npm run data:pull` first to mirror the CMS data locally.');
  process.exit(1);
}

console.log(`\nSyncing datas/*.gz to s3://${DO_SPACES_BUCKET}/datas/ ...`);
run(
  `aws s3 sync "datas/" "s3://${DO_SPACES_BUCKET}/datas/"` +
  ` --endpoint-url "${ENDPOINT}"` +
  ` --acl public-read` +
  ` --cache-control "public, max-age=0"` +
  ` --exclude "*" --include "maps_*.json.gz" --include "datas_*.json.gz"`
);

// Upload minified JS
console.log('\nUploading wayfinder-map.min.js...');
run(
  `aws s3 cp "dist/wayfinder-map.min.js" "s3://${DO_SPACES_BUCKET}/wayfinder-map.min.js"` +
  ` --endpoint-url "${ENDPOINT}"` +
  ` --acl public-read` +
  ` --cache-control "public, max-age=0, immutable"`
);

console.log(`\nDeployed to: ${ENDPOINT}/${DO_SPACES_BUCKET}/`);
console.log(`Gallery: ${ENDPOINT}/${DO_SPACES_BUCKET}/${BUILD_SECRET}/`);
console.log('Done.');
