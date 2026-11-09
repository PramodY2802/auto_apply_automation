// After `next build` (output: 'standalone'), copy the assets the standalone server
// does not include, so `pnpm start` serves CSS/JS correctly.
import { cpSync, existsSync, rmSync } from 'node:fs';

const target = '.next/standalone/apps/web';
if (!existsSync(target)) throw new Error(`${target} not found. Did next build run with output: 'standalone'?`);

rmSync(`${target}/.next/static`, { recursive: true, force: true });
cpSync('.next/static', `${target}/.next/static`, { recursive: true });
if (existsSync('public')) cpSync('public', `${target}/public`, { recursive: true });
console.log('Copied static assets into the standalone build');
