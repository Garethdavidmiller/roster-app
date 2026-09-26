/**
 * state.mjs — the one shared record behind the fake Firebase SDK (firebase-client.test.mjs).
 *
 * The three fake SDK modules and the test all import THIS file, so they see the same object. It is
 * a recorder first and a store second: every write the client makes lands in `ops` with its full
 * payload, because a harness that discards what it was handed cannot see the defect it exists for
 * (CLAUDE.md, "the rule tested, the wiring not"). The store is only rich enough for the reads the
 * tests make.
 */
export const state = {
    /** @type {Array<Record<string, any>>} every Firestore write, in order, with its payload */
    ops: [],
    /** @type {Map<string, Record<string, any>>} path → document data */
    docs: new Map(),
    /** @type {Array<{col: string, wheres: Array<{field: string, value: any}>, limit: number|null}>} every getDocs query */
    reads: [],
    /** @type {Array<Record<string, any>>} every Auth call that changes a credential or a session */
    authOps: [],
    /** the signed-in user, or null */
    currentUser: /** @type {any} */ (null),
    /** writes that should fail, by path prefix → an error code (fails once) or { code, times } */
    failNext: /** @type {Map<string, string | { code: string, times: number }>} */ (new Map()),
    /** reauthenticateWithCredential outcomes, by password → error code (absent = success) */
    reauthRejects: /** @type {Map<string, string>} */ (new Map()),
};

/** Put the recorder back to empty between tests. */
export function resetState() {
    state.ops.length = 0; state.reads.length = 0; state.docs.clear(); state.authOps.length = 0;
    state.currentUser = null; state.failNext.clear(); state.reauthRejects.clear();
}

/**
 * A signed-in user as the SDK hands one over: a uid, an email, and a token getter that records
 * whether the caller forced a refresh — the claim-retry and the admin endpoints both depend on it.
 * @param {{ uid?: string, email?: string, token?: string }} [o]
 */
export function signIn({ uid = 'uid_member', email = 'l.springer@myb-roster.local', token = 'id-token' } = {}) {
    state.currentUser = {
        uid, email,
        getIdToken: async (force = false) => { state.authOps.push({ op: 'getIdToken', force }); return token; },
        getIdTokenResult: async (force = false) => { state.authOps.push({ op: 'getIdTokenResult', force }); return { token, claims: {} }; },
    };
    return state.currentUser;
}
