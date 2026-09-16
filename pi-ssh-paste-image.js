#!/usr/bin/env node
import { runCli } from "./src/cli.js";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(`pi-ssh-paste-image: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
