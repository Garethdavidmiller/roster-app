/**
 * Static guard for the four pages' CARD_TIPS content.
 * Run: node --test tips-content.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS — a real staff-reported error, v19.13:
 *
 *     TypeError: tips.sections is not iterable
 *         at render (tips-lightbox.js:49)
 *
 * Tapping the `?` on Operations → Password Reset Requests threw and the panel never opened. The
 * entry had been hand-written in the OLD flat shape — `{ title, items: [...] }` — while the renderer
 * has required `{ title, sections: [{ items: [...] }] }` since the four copy-pasted implementations
 * were unified into `tips-lightbox.js`. Nine sibling entries in the same object were correct; this
 * one was added later, by hand, at the wrong indentation, and nothing looked.
 *
 * It could not have been caught by anything already in the suite: the content is a plain object
 * literal inside a 1,900-line coordinator, the renderer is only reachable through a DOM click, and
 * the e2e suite opens no tips panel. So it needed a human to press that one button on that one page.
 *
 * These checks are STRUCTURAL — they say the content matches the shape the renderer consumes, and
 * that every `?` button has content behind it. They say nothing about whether the wording is any good.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Pages that own a CARD_TIPS block, paired with the HTML whose `?` buttons consume it. */
const PAGES = [
    { js: 'admin-app.js',      html: 'admin.html' },
    { js: 'operations-app.js', html: 'operations.html' },
    { js: 'settings-app.js',   html: 'settings.html' },
    { js: 'links-app.js',      html: 'links.html' },
];

/**
 * Extract and evaluate the CARD_TIPS object literal. Evaluating rather than regexing is deliberate:
 * the defect that prompted this file was a SHAPE error, and a regex for `sections:` would have
 * happily matched the string "sections" anywhere in the entry's HTML.
 * @param {string} file
 */
function readCardTips(file) {
    const src = readFileSync(file, 'utf8');
    const at = src.indexOf('CARD_TIPS = {');
    assert.ok(at > -1, `${file}: no CARD_TIPS block found`);
    const start = src.indexOf('{', at);
    let depth = 0, end = -1;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    assert.ok(end > -1, `${file}: CARD_TIPS block is not brace-balanced`);
    return eval('(' + src.slice(start, end + 1) + ')');   // eslint-disable-line no-eval
}

/** The `data-card` values actually wired to a `?` button. @param {string} file */
function readWiredCards(file) {
    const html = readFileSync(file, 'utf8');
    return [...html.matchAll(/class="[^"]*btn-card-tips[^"]*"[^>]*data-card="([^"]+)"/g)].map(m => m[1]);
}

for (const { js, html } of PAGES) {
    describe(`${js} — tips content`, () => {
        const tips = readCardTips(js);

        test('every entry has a title and a non-empty sections ARRAY', () => {
            const broken = Object.entries(tips)
                .filter(([, v]) => !v || typeof v.title !== 'string' || !Array.isArray(v.sections) || !v.sections.length)
                .map(([k, v]) => `${k} (sections: ${JSON.stringify(v && v.sections)})`);
            assert.deepEqual(broken, [],
                `${js}: these entries do not match the shape tips-lightbox.js renders:\n  ` +
                broken.join('\n  ') +
                '\nThe renderer does `for (const section of tips.sections)`, so a flat ' +
                '`{ title, items }` throws "tips.sections is not iterable" the moment the ? is tapped.');
        });

        test('every section carries an items array, and every item an icon + html', () => {
            const broken = [];
            for (const [key, v] of Object.entries(tips)) {
                (v.sections || []).forEach((sec, i) => {
                    if (!Array.isArray(sec.items) || !sec.items.length) {
                        broken.push(`${key}.sections[${i}] has no items array`);
                        return;
                    }
                    sec.items.forEach((item, j) => {
                        if (typeof item.icon !== 'string' || typeof item.html !== 'string') {
                            broken.push(`${key}.sections[${i}].items[${j}] is missing icon/html`);
                        }
                    });
                });
            }
            assert.deepEqual(broken, [], `${js}:\n  ${broken.join('\n  ')}`);
        });

        test(`every ? button in ${html} has content behind it`, () => {
            // The other half of the same failure: a button whose key is absent hits the renderer's
            // `if (!tips) return`, so it throws nothing and does nothing — a silently dead control,
            // which is harder to notice than a crash.
            const missing = readWiredCards(html).filter(k => !(k in tips));
            assert.deepEqual(missing, [],
                `${html}: ? button(s) with no CARD_TIPS entry: ${missing.join(', ')}. The panel opens ` +
                'to nothing — the button is inert rather than broken, so no error is ever reported.');
        });

        test(`every entry in ${js} is reachable from a ? button`, () => {
            const wired = new Set(readWiredCards(html));
            const orphans = Object.keys(tips).filter(k => !wired.has(k));
            assert.deepEqual(orphans, [],
                `${js}: CARD_TIPS entries no button can open: ${orphans.join(', ')}. Either the card ` +
                'lost its ? button or the key was renamed on one side only.');
        });
    });
}
