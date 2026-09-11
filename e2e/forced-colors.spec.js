// @ts-check
/**
 * forced-colors.spec.js — WINDOWS HIGH CONTRAST, which no other lane in this repo can see.
 *
 * The app draws its own checkbox and radio (`appearance: none`, shared.css). Under
 * `forced-colors: active` the UA replaces author colours with the reader's theme — a background
 * becomes `Canvas`, a border `CanvasText` — and the checked fill and the tick's `::before` are
 * BOTH backgrounds. Before v23.67 both were forced to Canvas: a white tick on a white fill. A
 * checked box and an unchecked one painted with the same colours in the same pixel counts.
 *
 * Four reasons nothing else caught it, each of which is also why this file reads pixels:
 *   · `getComputedStyle` returns the AUTHOR value — the forcing happens at paint time — so a style
 *     assertion reads back the brand navy and calls it correct.
 *   · the visual baselines are captured with forced colours OFF.
 *   · axe has no rule for it.
 *   · every element is present, focusable and correctly labelled, so no behavioural assertion and
 *     no screen reader is affected. It is purely what the eye is shown.
 *
 * CHROMIUM ONLY, and that is the right engine rather than a gap: Windows High Contrast is a
 * Windows feature surfaced by Chromium and Edge, and Playwright's `forcedColors` emulation is
 * Chromium-only. The SHAPE of the CSS is pinned separately, in native-surface-parity.test.mjs
 * contract 13, which runs on every branch with nothing installed — so the contract survives even
 * where this spec does not run.
 *
 * **The split between the two is not redundancy, and it was established by mutation.** Deleting
 * the CSS block fails THIS spec; weakening it in any of the four ways that make it robust rather
 * than merely working — a brand token, a literal instead of a system colour, the tick drawn in the
 * fill colour, the disabled opacity left at 0.55 — passes here and fails contract 13. This spec
 * answers "can the reader see the state?"; that one answers "will it still be true on the next
 * engine?". Neither alone is the guard.
 *
 * The PNG decoder below is 25 lines of `node:zlib` rather than a dependency: the images are 20px
 * squares, and the no-install lane is a property of this repo worth not spending.
 *
 * ITS OWN FIRST CUT HAD A HOLE, recorded rather than tidied away: comparing whole histograms, the
 * broken CSS PASSED the unchecked-versus-checked case, because a white tick antialiased against a
 * white fill leaves a few off-white pixels and "different histogram" is not "a reader can tell".
 * Where the FILL should change, the fill is now what is asserted; the histogram is kept only for
 * the pair whose fill is identical by design.
 */
import { test, expect } from './fixtures.js';
import zlib from 'node:zlib';

/** Distinct RGB colours and their counts, for a small 8-bit PNG. */
function colourCounts(/** @type {Buffer} */ buf) {
    let p = 8, w = 0, h = 0, bd = 0, ct = 0; /** @type {Buffer[]} */ const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
        if (type === 'IDAT') idat.push(data);
        p += 12 + len;
    }
    if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported PNG (bd=${bd} ct=${ct})`);
    const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
    const out = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp] : 0;
            const b = y > 0 ? out[(y - 1) * stride + x] : 0;
            const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
            let v = line[x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            out[y * stride + x] = v & 255;
        }
    }
    /** @type {Map<string, number>} */ const tally = new Map();
    for (let i = 0; i < out.length; i += bpp) {
        const k = `${out[i]},${out[i + 1]},${out[i + 2]}`;
        tally.set(k, (tally.get(k) || 0) + 1);
    }
    const sorted = [...tally.entries()].sort((x, y) => y[1] - x[1]);
    return {
        /** The whole histogram — sensitive down to one antialiased pixel. */
        all: sorted.map(([k, n]) => `${k}x${n}`).join(' '),
        /** The colour most of the control is PAINTED in. What a reader actually sees. */
        fill: sorted[0][0],
    };
}

test.describe('Windows High Contrast — the drawn checkbox and radio', () => {
    test.skip(({ browserName }) => browserName !== 'chromium',
        'forced-colors emulation is Chromium-only; the CSS shape is pinned in native-surface-parity contract 13');

    test('every state of the drawn controls is DISTINGUISHABLE under forced colours', async ({ page }) => {
        await page.goto('/');
        await page.emulateMedia({ forcedColors: 'active' });
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
            'the emulation did not take — this test would pass by not testing').toBe(true);

        await page.evaluate(() => {
            document.body.insertAdjacentHTML('afterbegin',
                `<div id="fcProbe" style="position:fixed;top:0;left:0;z-index:99999;display:flex;gap:4px">
                   <input type="checkbox" id="fcU"><input type="checkbox" id="fcC" checked>
                   <input type="checkbox" id="fcI">
                   <input type="radio" id="fcRU"><input type="radio" id="fcRC" checked>
                   <input type="checkbox" id="fcDU" disabled>
                   <input type="checkbox" id="fcDC" checked disabled></div>`);
            /** @type {any} */ (document.getElementById('fcI')).indeterminate = true;
        });

        /** @type {Record<string, {all: string, fill: string}>} */ const seen = {};
        for (const [id, name] of /** @type {[string, string][]} */ ([
            ['#fcU', 'unchecked'], ['#fcC', 'checked'], ['#fcI', 'indeterminate'],
            ['#fcRU', 'radio unchecked'], ['#fcRC', 'radio checked'],
            ['#fcDU', 'disabled unchecked'], ['#fcDC', 'disabled checked'],
        ])) seen[name] = colourCounts(await page.locator(id).screenshot());

        // THE defect: a checked box that paints like an unchecked one. Where the FILL is supposed
        // to change, the fill is what gets asserted — and that distinction is not pedantry. The
        // first cut of this test compared whole histograms for every pair, and the broken CSS
        // PASSED the unchecked/checked case: a white tick antialiased against a white fill leaves
        // a handful of off-white pixels in the tail, so two controls a reader cannot tell apart
        // came back "different". Only `checked`/`indeterminate` — identical fill, different glyph,
        // and therefore genuinely identical when the glyph is not drawn — had teeth.
        for (const [a, b] of /** @type {[string, string][]} */ ([
            ['unchecked', 'checked'],
            ['radio unchecked', 'radio checked'],
        ])) {
            expect(seen[a].fill, `"${a}" and "${b}" are FILLED the same under forced colours — a reader cannot tell them apart`)
                .not.toBe(seen[b].fill);
        }

        // Same fill by design, so here the glyph is the whole difference and the histogram is the
        // right instrument: equal means the tick and the dash are both invisible.
        expect(seen['checked'].all, 'a checked box and an indeterminate one paint identically — the glyph is not being drawn')
            .not.toBe(seen['indeterminate'].all);
        // DISABLED is deliberately a greyed TICK on Canvas rather than a grey block — the answer
        // stays readable while the control says it cannot be changed — so its two states share a
        // fill BY DESIGN and the glyph is the whole difference. (The fill assertion above was
        // applied here first and failed on exactly that, which is the design being right and the
        // instrument being wrong.) The tick is ~67px of GrayText, not tail noise.
        expect(seen['disabled unchecked'].all, 'a disabled box does not show which way it is set')
            .not.toBe(seen['disabled checked'].all);
        expect(seen['checked'].fill, 'a disabled checked box must not be filled like an enabled one')
            .not.toBe(seen['disabled checked'].fill);

        // And the checked fill is the reader's own Highlight — not Canvas (the forcing winning),
        // and not a brand colour that survived `forced-color-adjust: none`.
        expect(seen['checked'].fill, 'the checked fill is Canvas — the forcing has won and the state is gone')
            .not.toBe(seen['unchecked'].fill);
    });
});
