// @ts-check
/**
 * e2e/signed-in-env.mjs — where the signed-in lane's emulators live, in ONE place.
 *
 * Read by three things that must agree: scripts/signed-in.mjs (which starts the emulators on these
 * ports), e2e/signed-in-setup.mjs (which provisions the accounts) and e2e/signed-in-fixtures.js (which
 * points the page's SDK at them). A port written into each would be three numbers that can drift, and
 * the symptom of a drift is a sign-in that hangs, not an error. Imports nothing, so plain Node can
 * load it before anything is installed beyond the root packages.
 */

/** The emulator project. `demo-` is Firebase's own marker for "no real resources, ever". */
export const PROJECT = 'demo-myb-roster';

/** Host:port of each emulator. */
export const EMULATOR = Object.freeze({
    auth: '127.0.0.1:9099',
    firestore: '127.0.0.1:8080',
    functions: '127.0.0.1:5001',
    storage: '127.0.0.1:9199',
});

/** The region every Cloud Function is deployed to (functions/index.js). */
export const REGION = 'europe-west2';

/**
 * The emulator settings for a run, BUILT FROM firebase.json rather than kept beside it: the rules
 * files, the indexes and the functions source come from the deployed config, so this lane can only
 * ever test what deploys. Only the emulator block is ours — firebase.json lists no Auth or Functions
 * emulator, and adding them there would start a Hosting deploy for a test-only change.
 * @param {any} firebaseJson
 */
export function emulatorConfig(firebaseJson) {
    const hostPort = (/** @type {string} */ hp) => {
        const [host, port] = hp.split(':');
        return { host, port: Number(port) };
    };
    return {
        functions: firebaseJson.functions,
        firestore: firebaseJson.firestore,
        storage: firebaseJson.storage,
        emulators: {
            auth: hostPort(EMULATOR.auth),
            firestore: hostPort(EMULATOR.firestore),
            functions: hostPort(EMULATOR.functions),
            storage: hostPort(EMULATOR.storage),
            ui: { enabled: false },
        },
    };
}

/**
 * Empty the Firestore emulator (every document, every collection). Accounts are untouched — they live
 * in the Auth emulator — so a test can start from a clean database without re-provisioning anybody.
 */
export async function resetDatabase() {
    let res;
    try {
        res = await fetch(`http://${EMULATOR.firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    } catch {
        // The usual cause by far: the lane was started without its emulators. Say so, rather than
        // the bare "fetch failed" every test would otherwise stop at.
        throw new Error(`no Firestore emulator at ${EMULATOR.firestore} — run this lane with \`npm run test:signed-in\`, which starts the emulators around it`);
    }
    if (!res.ok) throw new Error(`could not empty the Firestore emulator: HTTP ${res.status}`);
}

/**
 * Every document in one collection, read with the emulator's OWNER credential (`Bearer owner`), which
 * the Firestore emulator lets past the rules. This is the test's own eye on the database — what a
 * page managed to write, judged without asking the page — never a route the page itself could use.
 * @param {string} collection
 * @returns {Promise<Array<Record<string, any>>>}  each document's fields, decoded, plus `_id`
 */
export async function readCollection(collection) {
    const res = await fetch(`http://${EMULATOR.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?pageSize=500`,
        { headers: { authorization: 'Bearer owner' } });
    if (!res.ok) throw new Error(`could not read ${collection} from the Firestore emulator: HTTP ${res.status}`);
    const body = await res.json();
    return (body.documents || []).map((/** @type {any} */ d) => ({
        // The id exactly as stored: the emulator names a document by its raw id, and a manual record's
        // id is ALREADY percent-encoded by manualOverrideId — decoding it here would read a different id.
        _id: String(d.name).split('/').pop() || '',
        ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decodeValue(v)])),
    }));
}

/**
 * Put one document straight into the database, past the rules (`Bearer owner`) — for a test that
 * needs something to READ, such as a record a manager made last week. Strings only, plus a server-
 * shaped `createdAt`, which is all the documents this lane seeds carry.
 * @param {string} path       e.g. `overrides/<id>`
 * @param {Record<string, string>} fields
 */
export async function seedDocument(path, fields) {
    const encoded = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }]));
    encoded.createdAt = /** @type {any} */ ({ timestampValue: new Date().toISOString() });
    const res = await fetch(`http://${EMULATOR.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
        body: JSON.stringify({ fields: encoded }),
    });
    if (!res.ok) throw new Error(`could not seed ${path}: HTTP ${res.status} ${await res.text()}`);
}

/** @param {any} v  a Firestore REST value */
function decodeValue(v) {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decodeValue(x)]));
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
    return v;
}
