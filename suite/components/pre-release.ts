// suite/components/pre-release.ts
/**
 * Detect the pre-release version from PRE_RELEASE_VERSION env only.
 */
export function getPreReleaseVersion(): string | null {
  const v1 = (process.env.PRE_RELEASE_VERSION || '').trim();
  if (v1) return v1;
  return null;
}
