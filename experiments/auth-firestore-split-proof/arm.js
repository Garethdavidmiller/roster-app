// The measured body, shared by both arms so the ONLY difference between them is which SDK modules
// the importing page pulled in. Everything here — the calls, their order, the persistence ladder —
// mirrors firebase-client.js's module body and `authBootstrap`.
export function probe({ initializeApp, getAuth, connectAuthEmulator, onAuthStateChanged,
                        setPersistence, indexedDBLocalPersistence, browserLocalPersistence,
                        browserSessionPersistence, signInWithEmailAndPassword,
                        createUserWithEmailAndPassword, initFirestore }) {
    const t0 = performance.now();
    const app = initializeApp({ apiKey: 'fake-api-key', projectId: 'split-proof',
        authDomain: 'split-proof.firebaseapp.com' });

    // ARM A ONLY. firebase-client.js calls this in its module body, BEFORE getAuth — and
    // persistentLocalCache opens IndexedDB, which is the same store the auth restore reads from.
    // That ordering is the mechanism this experiment exists to price; bytes are the other half.
    const tFsStart = performance.now();
    if (initFirestore) initFirestore(app);
    const tFsDone = performance.now();

    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9098', { disableWarnings: true });

    const firstUser = () => new Promise(resolve => {
        const to = setTimeout(() => resolve(null), 10000);
        const off = onAuthStateChanged(auth, u => { clearTimeout(to); off(); resolve(u || null); });
    });
    const memberChain = () =>
        setPersistence(auth, indexedDBLocalPersistence).then(() => 'indexeddb')
            .catch(() => setPersistence(auth, browserLocalPersistence).then(() => 'local'))
            .catch(() => setPersistence(auth, browserSessionPersistence).then(() => 'session'));

    window.__P = {
        // Sign in once, so the NEXT load has something to restore. That is the population the
        // ladder's `Recognised` rung measures: a returning member, no typing.
        signIn: async () => {
            await memberChain();
            try { await createUserWithEmailAndPassword(auth, 'g.miller@myb-roster.local', 'miller-secret'); }
            catch { await signInWithEmailAndPassword(auth, 'g.miller@myb-roster.local', 'miller-secret'); }
            return auth.currentUser?.email || null;
        },
        // `authBootstrap`, timed from navigation start — the app's own `authBoot` milestone.
        authBoot: async () => {
            const user = await firstUser();
            const persistence = await memberChain();
            return {
                authBootMs: +(performance.now()).toFixed(1),
                moduleBodyStartMs: +t0.toFixed(1),
                firestoreInitMs: +(tFsDone - tFsStart).toFixed(1),
                restored: !!user,
                persistence,
            };
        },
    };
}
