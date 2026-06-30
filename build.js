import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function run() {
  console.log('Building CSS with Tailwind...');
  execSync('npx @tailwindcss/cli -i ./src/input.css -o ./src/styles.css --minify', { stdio: 'inherit' });

  console.log('Preparing dist/ directory...');
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  console.log('Copying static assets to dist...');
  fs.copyFileSync('src/index.html', 'dist/index.html');
  fs.copyFileSync('src/app.js', 'dist/app.js');
  fs.copyFileSync('src/styles.css', 'dist/styles.css');

  console.log('Build completed successfully!');
}

run();
