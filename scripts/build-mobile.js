#!/usr/bin/env node
/**
 * Build Mobile Private File — injects private Script URL from gitignored config into public template.
 * Usage: node scripts/build-mobile.js  or  npm run build:mobile
 * Reads: config/sheet.local.json  { scriptUrl }
 * Input: quicktrip-mobile/dist/mobile_app_public.html  (tracked, SCRIPT_URL_DEFAULT = "")
 * Output: quicktrip-mobile/dist/Mobile_with_url_private.html  (gitignored, standalone single-file for phone, URLs written by PS1)
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const localConfigPath = path.join(repoRoot, 'config', 'sheet.local.json');
const templatePath = path.join(repoRoot, 'quicktrip-mobile', 'dist', 'mobile_app_public.html');
const outputPath = path.join(repoRoot, 'quicktrip-mobile', 'dist', 'Mobile_with_url_private.html');

function loadScriptUrl() {
  // 1) Env override — PS1 $ScriptUrl sets $env:SCRIPT_URL to inject without touching config
  if (process.env.SCRIPT_URL && process.env.SCRIPT_URL.trim().includes('https')) return process.env.SCRIPT_URL.trim();
  if (process.env.NEXT_PUBLIC_SCRIPT_URL && process.env.NEXT_PUBLIC_SCRIPT_URL.trim().includes('https')) return process.env.NEXT_PUBLIC_SCRIPT_URL.trim();
  // 2) Try config/sheet.local.json (gitignored private)
  try {
    if (fs.existsSync(localConfigPath)) {
      const raw = fs.readFileSync(localConfigPath, 'utf8');
      const json = JSON.parse(raw);
      if (json.scriptUrl && typeof json.scriptUrl === 'string' && json.scriptUrl.includes('https')) {
        return json.scriptUrl.trim();
      }
    }
  } catch (e) {
    console.warn('[build-mobile] Failed to parse sheet.local.json:', e.message);
  }
  // 3) No hardcoded fallback — real URL must come from PS1 or config/sheet.local.json (both gitignored).
  console.warn('[build-mobile] No private URL found in $SCRIPT_URL / config/sheet.local.json — phone file will require Settings paste.');
  return '';
}

function build() {
  if (!fs.existsSync(templatePath)) {
    console.error(`[build-mobile] Template not found: ${templatePath}`);
    process.exit(1);
  }
  const template = fs.readFileSync(templatePath, 'utf8');
  const scriptUrl = loadScriptUrl();

  // Replace the public placeholder: const SCRIPT_URL_DEFAULT = "";
  // Handle both "" and existing URL forms
  let output;
  if (template.includes('const SCRIPT_URL_DEFAULT = ""')) {
    output = template.replace('const SCRIPT_URL_DEFAULT = ""', `const SCRIPT_URL_DEFAULT = "${scriptUrl}"`);
  } else if (template.includes('const SCRIPT_URL_DEFAULT =')) {
    output = template.replace(/const SCRIPT_URL_DEFAULT\s*=\s*".*?"/, `const SCRIPT_URL_DEFAULT = "${scriptUrl}"`);
  } else {
    console.error('[build-mobile] Could not find SCRIPT_URL_DEFAULT line in template');
    process.exit(1);
  }

  // Also patch the hint comment to reflect private generation
  output = output.replace(
    'Public template — no secret; generate private file via npm run build:mobile (reads config/sheet.local.json)',
    `Private build — injected from PS1/config on ${new Date().toISOString().slice(0, 10)}`
  );

  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`[build-mobile] Wrote ${path.relative(repoRoot, outputPath)}`);
  console.log(`[build-mobile]   scriptUrl: ${scriptUrl.slice(0, 60)}...`);
  console.log(`[build-mobile]   Copy this single file to phone → open in Chrome → Add to Home Screen. No Settings paste needed.`);
}

build();
