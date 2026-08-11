// Forces installation of the exact native binding Vite/rolldown needs on Linux, bypassing
// npm's optionalDependencies resolution entirely — that mechanism has a known, longstanding
// bug (npm/cli#4828) where it silently skips or fails to install nested platform-specific
// optional dependencies in some environments (observed here: Render's build containers).
// Declaring the package as a normal or top-level optional dependency wasn't reliable enough
// in practice, so this explicitly checks and force-installs it as a build step instead.
//
// No-ops on any non-Linux platform (e.g. local Windows/Mac development) — safe to run everywhere.
const { execSync } = require('child_process');

const BINDING_PKG = '@rolldown/binding-linux-x64-gnu';
const BINDING_VERSION = '1.2.3';

if (process.platform !== 'linux') {
  process.exit(0);
}

try {
  require.resolve(BINDING_PKG);
  console.log(`${BINDING_PKG} already resolvable, skipping force-install.`);
} catch {
  console.log(`${BINDING_PKG} not found — force-installing as a workaround for npm/cli#4828...`);
  try {
    execSync(`npm install --no-save --force ${BINDING_PKG}@${BINDING_VERSION}`, { stdio: 'inherit' });
    console.log(`${BINDING_PKG} installed successfully.`);
  } catch (err) {
    console.error(`Failed to force-install ${BINDING_PKG}:`, err.message);
    process.exit(1);
  }
}
