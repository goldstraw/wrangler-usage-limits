// The installed extension's entry point: the wrangler imports `index.js` from
// <DATA_DIR>/extensions/usage-limits/ and reads the default export. Tests import
// server/manifest.js instead: the wrangler's import scan quarantines an own file
// importing `../index.js`.
export { dir } from './server/manifest.js';
export { default } from './server/manifest.js';
