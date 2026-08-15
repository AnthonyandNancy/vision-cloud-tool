/**
 * Plugin package version.
 * @module dsh-vision-cloud/version
 */
import { readFileSync } from 'node:fs';
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
/** Plugin package version. */
export const PLUGIN_VERSION = metadata.version;
//# sourceMappingURL=version.js.map