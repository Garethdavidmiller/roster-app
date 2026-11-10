// @ts-check
/**
 * pdf-viewer-core.test.mjs — the in-app PDF viewer's rules (pdf-viewer-core.js): how big a page is drawn, the zoom
 * steps, when a file may be opened outside the app, which clicks the viewer takes, and what a failure says.
 * The viewer's wiring — the panel, PDF.js, the drawing — is e2e/newlink.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    ZOOM_STEPS, MAX_DEVICE_PIXEL_RATIO, MAX_CANVAS_PIXELS, MAX_FIT_WIDTH, zoomAfter, zoomLabel, pageLayout,
    canOpenOutside, isPlainClick, classifyFailure, FAILURE_TEXT, pageLabel, pagesLabel,
} from './pdf-viewer-core.js';

const A4 = { pageWidth: 594.96, pageHeight: 841.92 };      // the proposal sheets, the rules, the shortlist
const SLIDE = { pageWidth: 720, pageHeight: 405.014 };     // the presentations

describe('zoom', () => {
    test('steps in and out one at a time, and stops at either end', () => {
        assert.deepEqual([...ZOOM_STEPS], [1, 1.5, 2, 3]);
        assert.equal(zoomAfter(1, 1), 1.5);
        assert.equal(zoomAfter(1.5, 1), 2);
        assert.equal(zoomAfter(2, 1), 3);
        assert.equal(zoomAfter(3, 1), 3, 'no step past the largest');
        assert.equal(zoomAfter(3, -1), 2);
        assert.equal(zoomAfter(1, -1), 1, 'never smaller than the page filling the width');
    });
    test('a value between steps snaps to the nearest one first', () => {
        assert.equal(zoomAfter(1.4, 1), 2);
        assert.equal(zoomAfter(2.9, -1), 2);
    });
    test('as a reader says it', () => {
        assert.deepEqual(ZOOM_STEPS.map(zoomLabel), ['100%', '150%', '200%', '300%']);
    });
});

describe('page layout', () => {
    test('at 1×, a page fills the box and keeps its shape', () => {
        const l = pageLayout({ ...A4, boxWidth: 343, dpr: 2 });
        assert.equal(l.cssWidth, 343);
        assert.equal(l.cssHeight, Math.round(343 * A4.pageHeight / A4.pageWidth));
        const s = pageLayout({ ...SLIDE, boxWidth: 343, dpr: 2 });
        assert.equal(s.cssHeight, Math.round(343 * SLIDE.pageHeight / SLIDE.pageWidth), 'a slide is wider than tall');
    });
    test('drawn at the screen\'s density, never past 2×, and PDF.js is asked for exactly the canvas width', () => {
        const l = pageLayout({ ...A4, boxWidth: 343, dpr: 2 });
        assert.equal(l.pixelWidth, 686);
        assert.equal(l.scale, l.pixelWidth / A4.pageWidth);
        const iphone = pageLayout({ ...A4, boxWidth: 343, dpr: 3 });
        assert.equal(iphone.pixelWidth, 343 * MAX_DEVICE_PIXEL_RATIO, 'a 3× screen gets 2× — the memory, not the eye, is the limit');
        const old = pageLayout({ ...A4, boxWidth: 343, dpr: 1 });
        assert.equal(old.pixelWidth, 343);
        assert.equal(pageLayout({ ...A4, boxWidth: 343, dpr: 0 }).pixelWidth, 343, 'no ratio reported: one pixel per pixel');
    });
    test('zoom multiplies the size on screen', () => {
        for (const zoom of ZOOM_STEPS) {
            assert.equal(pageLayout({ ...A4, boxWidth: 343, zoom, dpr: 1 }).cssWidth, Math.floor(343 * zoom));
        }
    });
    test('no canvas holds more than the cap — a big zoom on a big page draws a little softer instead', () => {
        const l = pageLayout({ ...A4, boxWidth: 343, zoom: 3, dpr: 3 });
        assert.equal(l.cssWidth, 1029, 'it still takes its full size on screen');
        assert.ok(l.pixelWidth * l.pixelHeight <= MAX_CANVAS_PIXELS, `${l.pixelWidth}×${l.pixelHeight} is over the cap`);
        assert.ok(l.pixelWidth * l.pixelHeight > MAX_CANVAS_PIXELS * 0.98, 'and uses nearly all of it');
        assert.ok(l.pixelWidth > l.cssWidth, 'still sharper than one pixel per pixel');
        for (const zoom of ZOOM_STEPS) for (const dpr of [1, 2, 3]) for (const page of [A4, SLIDE]) {
            const x = pageLayout({ ...page, boxWidth: 1400, zoom, dpr });
            assert.ok(x.pixelWidth * x.pixelHeight <= MAX_CANVAS_PIXELS, `${zoom}× at ${dpr}: ${x.pixelWidth}×${x.pixelHeight}`);
        }
    });
    test('on a wide screen a page is never blown up past a readable width', () => {
        const l = pageLayout({ ...SLIDE, boxWidth: 1880, dpr: 1 });
        assert.equal(l.cssWidth, MAX_FIT_WIDTH);
        assert.equal(pageLayout({ ...SLIDE, boxWidth: 1880, zoom: 2, dpr: 1 }).cssWidth, MAX_FIT_WIDTH * 2, 'zoom still works from there');
    });
    test('a box with no width yet still gives every size at least one pixel', () => {
        const l = pageLayout({ ...A4, boxWidth: 0, dpr: 2 });
        for (const v of [l.cssWidth, l.cssHeight, l.pixelWidth, l.pixelHeight]) assert.ok(v >= 1);
    });
});

describe('opening a file outside the app', () => {
    const MIRROR_PAGE = 'https://garethdavidmiller.github.io/roster-app/newlink.html';
    const FIREBASE_PAGE = 'https://myb-roster.web.app/newlink.html';
    const PACK_FILE = 'https://garethdavidmiller.github.io/roster-app/docs/links-26/links-26-rules.pdf';

    test('THE TRAP: installed from the mirror, the pack is inside the app — never offered (the iPhone with no way back)', () => {
        assert.equal(canOpenOutside({ fileUrl: PACK_FILE, pageUrl: MIRROR_PAGE, standalone: true }), false);
    });
    test('installed from Firebase, the mirror is outside the app — the phone opens it in its own viewer, with Done', () => {
        assert.equal(canOpenOutside({ fileUrl: PACK_FILE, pageUrl: FIREBASE_PAGE, standalone: true }), true);
    });
    test('in a browser tab, always — the file gets a tab of its own, and the browser a way back', () => {
        assert.equal(canOpenOutside({ fileUrl: PACK_FILE, pageUrl: MIRROR_PAGE, standalone: false }), true);
        assert.equal(canOpenOutside({ fileUrl: PACK_FILE, pageUrl: FIREBASE_PAGE, standalone: false }), true);
    });
    test('the scope is the folder the pages are in — a sibling repository on the same host is outside it', () => {
        const other = 'https://garethdavidmiller.github.io/other-repo/file.pdf';
        assert.equal(canOpenOutside({ fileUrl: other, pageUrl: MIRROR_PAGE, standalone: true }), true);
        const ownFile = 'https://myb-roster.web.app/docs/links-26/x.pdf';
        assert.equal(canOpenOutside({ fileUrl: ownFile, pageUrl: FIREBASE_PAGE, standalone: true }), false, 'Firebase\'s scope is the whole host');
    });
    test('a relative address is read against the page', () => {
        assert.equal(canOpenOutside({ fileUrl: 'docs/links-26/x.pdf', pageUrl: MIRROR_PAGE, standalone: true }), false);
    });
    test('an address that cannot be read is not one to send a reader to', () => {
        assert.equal(canOpenOutside({ fileUrl: 'http://[bad', pageUrl: MIRROR_PAGE, standalone: true }), false);
    });
});

describe('which clicks the viewer takes', () => {
    test('a plain click or tap — and Enter on a link, which is a click with button 0', () => {
        assert.equal(isPlainClick({ button: 0 }), true);
        assert.equal(isPlainClick({}), true);
    });
    test('not one asking the browser for a tab or a window', () => {
        for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) assert.equal(isPlainClick({ button: 0, [mod]: true }), false, mod);
        assert.equal(isPlainClick({ button: 1 }), false, 'the middle button');
    });
    test('not one something else has already handled', () => {
        assert.equal(isPlainClick({ button: 0, defaultPrevented: true }), false);
    });
});

describe('failures', () => {
    test('no signal, or too slow, is a connection to fix', () => {
        assert.equal(classifyFailure({ online: false }), 'connection');
        assert.equal(classifyFailure({ timedOut: true }), 'connection');
        assert.equal(classifyFailure({ networkError: true }), 'connection');
        assert.equal(classifyFailure({ online: false, status: 404 }), 'connection', 'offline wins: the 404 may be a captive portal');
    });
    test('a missing file means the list is older than the pack', () => {
        assert.equal(classifyFailure({ status: 404 }), 'gone');
        assert.equal(classifyFailure({ status: 410 }), 'gone');
    });
    test('anything else is the admin\'s', () => {
        assert.equal(classifyFailure({ status: 500 }), 'broken');
        assert.equal(classifyFailure({}), 'broken', 'a file PDF.js could not read');
    });
    test('each says what to do, calmly, and an app fault goes to the admin (CLAUDE.md wording)', () => {
        assert.match(FAILURE_TEXT.connection, /connection.*try again/i);
        assert.match(FAILURE_TEXT.gone, /Reload the page/);
        assert.match(FAILURE_TEXT.broken, /tell the admin/);
        for (const text of Object.values(FAILURE_TEXT)) assert.doesNotMatch(text, /!/, 'no exclamation marks');
    });
});

test('page names', () => {
    assert.equal(pageLabel(3, 8), 'Page 3 of 8');
    assert.equal(pagesLabel(1), '1 page');
    assert.equal(pagesLabel(15), '15 pages');
});
