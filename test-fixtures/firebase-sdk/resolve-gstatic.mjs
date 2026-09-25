/**
 * resolve-gstatic.mjs — a module resolve hook that answers the Firebase SDK's CDN URLs with the
 * local fakes beside it (registered by firebase-client.test.mjs through `node:module` register).
 *
 * Why a hook and not `mock.module`: Node refuses an `https:` specifier at resolution
 * (ERR_UNSUPPORTED_ESM_URL_SCHEME), and `mock.module` resolves before it replaces, so the CDN import
 * at the top of firebase-client.js could not be mocked at all — which is exactly why that file was
 * the one part of the client with no test (KNOWN_LIMITATIONS → "Still genuinely untested").
 * Any SDK module the fakes do not provide fails LOUDLY here rather than resolving to something
 * half-built.
 */
const SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+)\.js$/;
const PROVIDED = new Set(['firebase-app', 'firebase-auth', 'firebase-firestore']);

export async function resolve(specifier, context, next) {
    const m = SDK.exec(specifier);
    if (!m) return next(specifier, context);
    if (!PROVIDED.has(m[1])) throw new Error(`resolve-gstatic: no fake for ${m[1]} — add one to test-fixtures/firebase-sdk/`);
    return { url: new URL(`./${m[1]}.mjs`, import.meta.url).href, shortCircuit: true };
}
