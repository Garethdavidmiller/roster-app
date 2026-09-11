// @ts-check
/**
 * upload-cap-parity.test.mjs — the 20 MB document upload cap is declared in THREE places, on three
 * sides of two boundaries, and nothing made them agree.
 *
 * The three: `MAX_UPLOAD_BYTES` in `doc-upload.js` (the browser refuses the file at the picker),
 * `MAX_FILE_BYTES` in `functions/index.js` (ingestHuddle and parseRosterPDF refuse the decoded
 * bytes), and `request.resource.size` in the three upload blocks of `storage.rules` (the server
 * refuses the object). They cannot import one another — a browser ES module, a CommonJS Cloud
 * Function and a rules file are three languages — so this is the `surname-parity` boundary again,
 * and the same answer: derive all three from source and compare.
 *
 * Organised by what a disagreement COSTS, and the two directions are not symmetrical:
 *
 *  - A CLIENT CAP ABOVE the rule's is the expensive one, and it is silent until the very end. The
 *    card accepts the file, the admin waits out a full upload on whatever connection the station
 *    has, and Storage refuses the object on the last byte — surfacing as the card's generic upload
 *    failure, with no mention of size, at the one moment the admin has spent the most time. The
 *    same shape hides behind the Function: a body the client happily encodes, refused at
 *    `MAX_FILE_BYTES` after the whole request has gone up.
 *  - A CLIENT CAP BELOW the rule's only refuses early, with the right message. It costs an admin a
 *    re-export of a file that would in fact have been accepted.
 *  - THE SENTENCE is the third source. "maximum 20 MB" is the only place an admin can read the
 *    limit; a cap moved without it states a number that is not the rule.
 *
 * `storage-rules-static.test.mjs` already asserts the cap is PRESENT in all three rules blocks.
 * That is a different question — it fails on a deletion, this fails on a disagreement — so both
 * stay. Reads source text only: no install, no emulator. Part of test:hygiene.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (/** @type {string} */ rel) => readFileSync(join(__dirname, rel), 'utf8');

const CLIENT   = read('doc-upload.js');
const FUNCTION = read('functions/index.js');
const RULES    = read('storage.rules');

/**
 * Evaluate a byte expression written as a product of integers ("20 * 1024 * 1024", "20971520").
 * Deliberately not `eval` and deliberately not a hardcoded 20971520 on this side — a parity test
 * that restates the number it is checking has nothing to compare.
 * @param {string} expr
 * @returns {number}
 */
function bytes(expr) {
    const parts = expr.split('*').map(s => s.trim());
    assert.ok(parts.every(p => /^\d+$/.test(p)), `unparseable byte expression: ${expr}`);
    return parts.reduce((n, p) => n * Number(p), 1);
}

/**
 * Pull one `const NAME = <expr>;` byte declaration out of a JS source file.
 * @param {string} src @param {string} name @param {string} where
 */
function declared(src, name, where) {
    const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\d\\s*]+);`));
    assert.ok(m, `${where} no longer declares ${name} as a byte expression — this guard is blind`);
    return bytes(m[1]);
}

const clientCap   = declared(CLIENT, 'MAX_UPLOAD_BYTES', 'doc-upload.js');
const functionCap = declared(FUNCTION, 'MAX_FILE_BYTES', 'functions/index.js');
const rulesCaps   = [...RULES.matchAll(/request\.resource\.size\s*<=\s*([\d\s*]+)\b/g)].map(m => bytes(m[1]));

describe('the upload cap — one limit, three languages', () => {
    test('the three rules blocks all cap at the same size', () => {
        // Each block is hand-written, so the drift that matters here is one block bumped and the
        // other two left. A reader comparing them by eye is comparing three identical-looking
        // multiplications thirty lines apart.
        assert.equal(rulesCaps.length, 3,
            `expected a size cap in each of the 3 upload blocks (huddles, circulars, newsletters), found ${rulesCaps.length}`);
        assert.equal(new Set(rulesCaps).size, 1,
            `the three storage.rules upload blocks disagree about the cap: ${rulesCaps.join(' / ')}`);
    });

    test('the browser never accepts a file Storage will refuse', () => {
        // The expensive direction. `<=` rather than `===` would be the weaker rule and is not what
        // is wanted: below the rule is merely annoying, but a client that quietly refuses files the
        // service accepts is still a bug somebody has to diagnose. All three are meant to be ONE
        // number, so assert equality and let a deliberate divergence come with a reason.
        assert.equal(clientCap, rulesCaps[0],
            `doc-upload.js MAX_UPLOAD_BYTES (${clientCap}) and storage.rules (${rulesCaps[0]}) disagree`);
    });

    test('the Cloud Functions cap is the same number the browser and the rules use', () => {
        // ingestHuddle is reached by Power Automate, which never sees doc-upload.js — so this side
        // is not redundant with the client check, it is the only cap on that path.
        assert.equal(functionCap, rulesCaps[0],
            `functions/index.js MAX_FILE_BYTES (${functionCap}) and storage.rules (${rulesCaps[0]}) disagree`);
    });

    test('every sentence that states the limit states the limit that is enforced', () => {
        // The admin-facing copy in doc-upload.js and the Function's own 4xx body both name a figure
        // in MB. A cap raised without them leaves the app telling an admin a number that is not
        // true, in the one place they can read it at all.
        const mb = rulesCaps[0] / (1024 * 1024);
        assert.ok(Number.isInteger(mb), `the cap is no longer a whole number of MB (${mb}) — reword the copy check`);
        for (const [src, where] of [[CLIENT, 'doc-upload.js'], [read('functions/documents.js'), 'functions/documents.js']]) {
            const stated = [...String(src).matchAll(/(\d+)\s?MB/g)].map(m => Number(m[1]));
            assert.ok(stated.length, `${where} states no MB figure — has the message stopped naming the limit?`);
            const wrong = stated.filter(n => n !== mb);
            assert.deepEqual(wrong, [],
                `${where} states ${wrong.join('/')} MB where the enforced cap is ${mb} MB`);
        }
    });
});
