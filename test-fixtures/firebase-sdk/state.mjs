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
    /** writes the server has not acknowledged yet, by path prefix → a promise the next such write
     *  waits on before it resolves (once). Recorded in `ops` at once: it was SENT. */
    holdNext: /** @type {Map<string, Promise<any>>} */ (new Map()),
    /** reauthenticateWithCredential outcomes, by password → error code (absent = success) */
    reauthRejects: /** @type {Map<string, string>} */ (new Map()),
    /** true = the SDK has gone OFFLINE: every read is answered by this device's cache and says so
     *  (`metadata.fromCache`), and a document the cache does not hold rejects `unavailable`, as the
     *  real `getDoc` does (settings-ops-1) */
    fromCache: false,
    /** what `waitForPendingWrites` waits on — null: nothing queued on this device, so it answers at once */
    pendingWrites: /** @type {Promise<any>|null} */ (null),
    /** every live `onAuthStateChanged` subscriber, told when the fake signs the account out mid-refresh */
    authListeners: /** @type {Set<(u: any) => void>} */ (new Set()),
    /** when the signed-in user's ID token was issued, in ms — the token service's clock, which a test
     *  can hold apart from this device's (mocked) one; null = the moment `getIdTokenResult` is asked */
    tokenIssuedAt: /** @type {number|null} */ (null),
};

/** Put the recorder back to empty between tests. */
export function resetState() {
    state.ops.length = 0; state.reads.length = 0; state.docs.clear(); state.authOps.length = 0;
    state.currentUser = null; state.failNext.clear(); state.holdNext.clear(); state.reauthRejects.clear();
    state.fromCache = false; state.pendingWrites = null; state.authListeners.clear(); state.tokenIssuedAt = null;
}

/**
 * A signed-in user as the SDK hands one over: a uid, an email, and a token getter that records
 * whether the caller forced a refresh — the claim-retry and the admin endpoints both depend on it.
 *
 * `refreshRefusedWith` makes a FORCED refresh fail as the real SDK's does for an account disabled or
 * revoked since its token was minted: `_logoutIfInvalidated` signs the account out, its listeners are
 * told in a microtask, and only THEN does the refresh re-throw. The order is the point — it is how a
 * sign-out came to overtake a refusal (claim-retry.js → runWatchedClaimRetry).
 * @param {{ uid?: string, email?: string, token?: string, refreshRefusedWith?: string }} [o]
 */
export function signIn({ uid = 'uid_member', email = 'l.springer@myb-roster.local', token = 'id-token', refreshRefusedWith } = {}) {
    state.currentUser = {
        uid, email,
        getIdToken: async (force = false) => {
            state.authOps.push({ op: 'getIdToken', force });
            if (force && refreshRefusedWith) {
                state.currentUser = null;
                for (const listener of state.authListeners) queueMicrotask(() => listener(null));
                await Promise.resolve();
                throw Object.assign(new Error(refreshRefusedWith), { code: refreshRefusedWith });
            }
            return token;
        },
        // `issuedAtTime` as the real SDK spells it: the token's `iat`, as a UTC date string.
        getIdTokenResult: async (force = false) => { state.authOps.push({ op: 'getIdTokenResult', force });
            return { token, claims: {}, issuedAtTime: new Date(state.tokenIssuedAt ?? Date.now()).toUTCString() }; },
    };
    return state.currentUser;
}
