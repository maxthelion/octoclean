#!/usr/bin/env node

// Entry point — delegates to the compiled CLI.
// During development, use: npx tsx src/cli/index.ts

import('../dist/cli/index.js').catch(err => {
  // If dist/ doesn't exist yet, try running via tsx for convenience
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('No dist/ build found. Run: npm run build');
    console.error('Or for development: npx tsx src/cli/index.ts');
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
