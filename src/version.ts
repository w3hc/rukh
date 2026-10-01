import { readFileSync } from 'fs';
import { join } from 'path';

// Resolves the same way from src/ (ts-node, jest) and dist/ (build output),
// both one level below the package root
export const APP_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
).version;
