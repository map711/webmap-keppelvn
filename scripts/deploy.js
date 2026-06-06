import 'dotenv/config';
import { execSync } from 'child_process';

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

// Upload the map data bundle. The gallery pages reference ../datas/SGC_v001.json,
// which resolves to the bucket root from inside <secret>/.
console.log(`\nSyncing datas/ to s3://${DO_SPACES_BUCKET}/datas/ ...`);
run(
  `aws s3 sync "datas/" "s3://${DO_SPACES_BUCKET}/datas/"` +
  ` --endpoint-url "${ENDPOINT}"` +
  ` --acl public-read` +
  ` --cache-control "public, max-age=0"` +
  ` --delete`
);

// Upload the qrcode-generator shim the gallery's importmap points at
// (../qa-shims/qrcode-generator.js — qrcode is a not-yet-installed Phase-3 dep
// the shipped bundle externalizes).
console.log(`\nSyncing qa-shims/ to s3://${DO_SPACES_BUCKET}/qa-shims/ ...`);
run(
  `aws s3 sync "qa-shims/" "s3://${DO_SPACES_BUCKET}/qa-shims/"` +
  ` --endpoint-url "${ENDPOINT}"` +
  ` --acl public-read` +
  ` --cache-control "public, max-age=0"` +
  ` --delete`
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
