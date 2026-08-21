const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]s$/;

/**
 * Resolve hook: for extensionless relative specifiers (e.g. "./vocab"),
 * try "<specifier>.ts" first so type-stripped source modules resolve under
 * `node --experimental-strip-types`. Falls back to default resolution.
 */
export async function resolve(specifier, context, nextResolve) {
  if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through to default resolution below
    }
  }
  return nextResolve(specifier, context);
}
