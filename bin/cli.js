#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';

console.log("🚀 [Fullstack Bootstrap AI] Initializing Continue configuration...");

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@joaosens/fullstack-bootstrap-ai/package.json');
const packageDir = path.dirname(packageJsonPath).replace(/\\/g, '/');

const homeDir = os.homedir();
const configPath = path.join(homeDir, '.continue', 'config.yaml');

if (!fs.existsSync(configPath)) {
  console.error(`❌ Error: Configuration file not found at: ${configPath}`);
  console.log("Please make sure the Continue extension is installed in your IDE.");
  process.exit(1);
}

const promptsToAppend = `
prompts:
  - uses: file://${packageDir}/rules/Backend.Rules.md
  - uses: file://${packageDir}/rules/Frontend.Rules.md
  - uses: file://${packageDir}/skills/Main.Skill.md
  - uses: file://${packageDir}/skills/Examples.Skill.md
  - uses: file://${packageDir}/mcp/Guide.MCP.md
`;

try {
  let currentConfig = fs.readFileSync(configPath, 'utf8');
  
  if (currentConfig.includes('@joaosens/fullstack-bootstrap-ai')) {
    console.log("✨ All modular prompts are already configured in your config.yaml!");
    process.exit(0);
  }

  fs.appendFileSync(configPath, promptsToAppend, 'utf8');
  console.log("✅ Success! All 5 prompt modules are now linked to your AI agent.");
  console.log("🔄 Please restart your IDE chat interface to reload settings.");

} catch (error) {
  console.error("❌ An unexpected error occurred while modifying config.yaml:", error.message);
  process.exit(1);
}
