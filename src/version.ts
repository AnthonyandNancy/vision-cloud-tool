/**
 * Plugin package version.
 * @module dsh-vision-cloud/version
 */

import { readFileSync } from 'node:fs'

interface PackageMetadata {
  version: string
}

const metadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageMetadata

/** Plugin package version. */
export const PLUGIN_VERSION = metadata.version
