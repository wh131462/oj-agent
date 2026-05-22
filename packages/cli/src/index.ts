#!/usr/bin/env node
import { main } from './cli.js';

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write('fatal: ' + (err?.stack ?? err) + '\n');
    process.exit(1);
  });
