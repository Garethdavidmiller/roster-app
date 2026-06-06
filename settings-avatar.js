/**
 * settings-avatar.js — Profile photo card for settings.html.
 *
 * Lets a staff member set a small profile picture that appears as a badge in the
 * nav-panel footer (and a larger preview here). The flow is:
 *   Choose photo → reposition (drag/zoom) → Save  (or Cancel / Remove).
 *
 * Reposition editor: after a photo is chosen, an inline square editor lets the
 * user drag to pan and zoom (slider · pinch · wheel · arrow keys) to frame the
 * shot inside the avatar window. On Save, the visible square is exported to a
 * ~256px JPEG entirely in the browser (canvas) — so the stored file is a few KB
 * regardless of the camera photo size — and uploaded. Both the live preview and
 * the exported crop are rendered from the SAME orientation-corrected ImageBitmap
 * with identical geometry, so what you see is exactly what is saved.
 *
 * Upload + Firestore pointer live in firebase-client.js (uploadAvatar /
 * deleteAvatar / fetchAvatarUrl).
 *
 * Cross-page sync: after a save/remove we cache the URL in localStorage (instant
 * paint elsewhere on this device) and dispatch a `myb:avatar-changed` event that
 * nav-panel.js listens for, so the footer badge updates without a reload.
 */

import { uploadAvatar, deleteAvatar, fetchAvatarUrl } from './firebase-client.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { avatarCacheKey, paintAvatar } from './avatar.js';

const OUT_SIZE     = 256;   // exported JPEG edge length (px)
const JPEG_QUALITY = 0.82;  // exported JPEG quality 0–1
const MAX_ZOOM     = 4;     // maximum zoom factor above cover-fit
const KEY_PAN_STEP = 16;    // arrow-key pan distance (CSS px)

/** Clamp n into [lo, hi]. */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Load an image File into something drawable. Uses createImageBitmap with
 * EXIF-orientation correction where available (so portrait phone photos aren't
 * sideways), falling back to an HTMLImageElement.
 * @param {File} file
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function fileToDrawable(file) {
    if ('createImageBitmap' in window) {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (_) { /* fall through to <img> */ }
    }
    return await new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload  = () => { URL.revokeObjectURL(objUrl); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Could not read image')); };
        img.src = objUrl;
    });
}

/**
 * Initialise the Profile photo card.
 * @param {{ memberName: string, awaitSession?: Promise<any>|null }} opts
 *   memberName   — the signed-in member.
 *   awaitSession — resolves when Firebase Auth is re-established; awaited before
 *                  any Storage/Firestore write so the request.auth rule passes.
 */
export function initAvatarCard({ memberName, awaitSession = null }) {
    const preview      = document.getElementById('avatarPreview');
    const chooseBtn    = document.getElementById('avatarChooseBtn');
    const removeBtn    = document.getElementById('avatarRemoveBtn');
    const fileInput    = document.getElementById('avatarFileInput');
    const statusEl     = document.getElementById('avatarStatus');
    const avatarRow    = document.getElementById('avatarRow');
    const editor       = document.getElementById('avatarEditor');
    const canvas       = document.getElementById('avatarEditorCanvas');
    const zoomSlider   = document.getElementById('avatarZoom');
    const editorSave   = document.getElementById('avatarEditorSaveBtn');
    const editorCancel = document.getElementById('avatarEditorCancelBtn');
    if (!preview || !chooseBtn || !fileInput || !memberName) return;
    if (!editor || !canvas || !zoomSlider || !editorSave || !editorCancel) return;

    const ctx = canvas.getContext('2d');

    let currentUrl = null;   // the saved avatar URL (null = initials)
    let touched    = false;  // user acted — the slow initial fetch must not override them

    // ── Editor geometry (all in viewport CSS px unless noted) ──
    let src        = null;   // ImageBitmap|HTMLImageElement being edited (null = editor closed)
    let Wn = 0, Hn = 0;      // src natural pixel dimensions
    let V          = 0;      // viewport (square) edge length in CSS px
    let coverScale = 1;      // natural→CSS factor that makes the image cover the viewport at z=1
    let z          = 1;      // current zoom factor (>= 1)
    let px = 0, py = 0;      // image top-left within the viewport

    // ── Pointer/gesture state ──
    const pointers   = new Map(); // pointerId → { x, y } in viewport-local CSS px
    let rect         = null;      // canvas bounding rect captured at gesture start (client→local)
    let panLast      = null;      // { x, y } last single-pointer position
    let pinchPrev    = null;      // { dist, x, y } previous two-pointer distance + midpoint
    let rafId        = 0;         // pending render requestAnimationFrame id (0 = none)
    let openRaf      = 0;         // pending open-measure requestAnimationFrame id (0 = none)
    let editorReady  = false;     // true once openEditor has measured + centred (gates the observer)

    function setStatus(msg, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('error', isError);
    }

    /** Reflect saved-state buttons (Remove visible only when a photo exists). */
    function syncButtons() {
        if (removeBtn) removeBtn.style.display = currentUrl ? '' : 'none';
    }

    // ── Initial paint: initials immediately, then cached URL, then Firestore ──
    paintAvatar(preview, null, memberName);
    const cached = lsGet(avatarCacheKey(memberName));
    if (cached) { currentUrl = cached; paintAvatar(preview, cached, memberName); }
    syncButtons();
    fetchAvatarUrl(memberName).then(url => {
        // Don't clobber a choice/save/remove the user has already made — this
        // fetch was issued at load and may resolve after a quick user action.
        if (touched) return;
        currentUrl = url || null;
        if (currentUrl) lsSet(avatarCacheKey(memberName), currentUrl);
        else            lsDel(avatarCacheKey(memberName));
        paintAvatar(preview, currentUrl, memberName);
        syncButtons();
    });

    // ════════════════════════════════════════════════════════════════════════
    //  Editor rendering + geometry
    // ════════════════════════════════════════════════════════════════════════

    /** Keep the image covering the viewport — no empty gaps at any zoom. */
    function clampPos() {
        const imgW = Wn * coverScale * z;
        const imgH = Hn * coverScale * z;
        px = clamp(px, V - imgW, 0); // V - imgW <= 0 since imgW >= V
        py = clamp(py, V - imgH, 0);
    }

    /** Draw the current view into the on-screen canvas (dpr-aware, coalesced). */
    function render() {
        rafId = 0;
        if (!src) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // map CSS px → backing-store px
        ctx.clearRect(0, 0, V, V);
        ctx.drawImage(src, px, py, Wn * coverScale * z, Hn * coverScale * z);
    }

    /** Coalesce multiple gesture updates into one paint per frame. */
    function scheduleRender() {
        if (rafId) return;
        rafId = requestAnimationFrame(render);
    }

    /**
     * Set the zoom factor, keeping the natural pixel under (anchorX, anchorY)
     * fixed on screen. Defaults to the viewport centre (slider / wheel).
     */
    function setZoom(newZ, anchorX = V / 2, anchorY = V / 2) {
        newZ = clamp(newZ, 1, MAX_ZOOM);
        const k0 = coverScale * z;
        const k1 = coverScale * newZ;
        const nx = (anchorX - px) / k0; // natural coord under the anchor (CSS-px space)
        const ny = (anchorY - py) / k0;
        z  = newZ;
        px = anchorX - nx * k1;
        py = anchorY - ny * k1;
        clampPos();
        if (zoomSlider) zoomSlider.value = String(z);
        scheduleRender();
    }

    /** Measure the on-screen viewport and size the canvas backing store. */
    function measureViewport() {
        const r = canvas.getBoundingClientRect();
        V = Math.round(r.width);
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.max(1, Math.round(V * dpr));
        canvas.height = Math.max(1, Math.round(V * dpr));
    }

    /** Centre the image at the current zoom (used on open + on resize). */
    function centreImage() {
        coverScale = Math.max(V / Wn, V / Hn);
        const imgW = Wn * coverScale * z;
        const imgH = Hn * coverScale * z;
        px = (V - imgW) / 2;
        py = (V - imgH) / 2;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Editor open / close
    // ════════════════════════════════════════════════════════════════════════

    /** Release the ImageBitmap + reset gesture state. */
    function disposeSrc() {
        if (src && typeof src.close === 'function') src.close();
        src = null;
        editorReady = false;
        pointers.clear();
        panLast = null;
        pinchPrev = null;
        if (rafId)   { cancelAnimationFrame(rafId);   rafId = 0; }
        if (openRaf) { cancelAnimationFrame(openRaf); openRaf = 0; }
    }

    function setEditorOpen(open) {
        editor.hidden = !open;
        if (avatarRow) avatarRow.style.display = open ? 'none' : '';
    }

    /** Show the editor for a freshly chosen drawable image. */
    function openEditor(drawable) {
        disposeSrc(); // free any previous bitmap first
        src = drawable;
        Wn = drawable.width;
        Hn = drawable.height;
        z  = 1;
        setEditorOpen(true);
        // Measure after the browser has laid the now-visible editor out.
        openRaf = requestAnimationFrame(() => {
            openRaf = 0;
            if (!src) return; // cancelled / re-picked before layout settled
            measureViewport();
            if (!V) { // ultra-defensive: hidden ancestor → fall back to a sane size
                V = 240;
                const dpr = window.devicePixelRatio || 1;
                canvas.width = canvas.height = Math.round(V * dpr);
            }
            centreImage();
            if (zoomSlider) zoomSlider.value = '1';
            render();
            editorReady = true;
        });
    }

    function closeEditor() {
        setEditorOpen(false);
        disposeSrc();
    }

    /** Export the currently-framed square to a ~256px JPEG blob. */
    function exportBlob() {
        const k = coverScale * z;       // CSS px per natural px
        const sSize = V / k;            // natural-pixel size of the visible square
        // Clamp defensively against float drift so the source rect stays in-bounds.
        const sx = clamp(-px / k, 0, Wn - sSize);
        const sy = clamp(-py / k, 0, Hn - sSize);
        const out = document.createElement('canvas');
        out.width = out.height = OUT_SIZE;
        const octx = out.getContext('2d');
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(src, sx, sy, sSize, sSize, 0, 0, OUT_SIZE, OUT_SIZE);
        return new Promise((resolve, reject) =>
            out.toBlob(
                b => b ? resolve(b) : reject(new Error('Could not process image')),
                'image/jpeg', JPEG_QUALITY
            ));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Gestures
    // ════════════════════════════════════════════════════════════════════════

    /** Convert a pointer event to viewport-local CSS px using the cached rect. */
    function toLocal(e) {
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /** Distance + midpoint of the two active pointers (viewport-local). */
    function computePinch() {
        const [a, b] = [...pointers.values()];
        return {
            dist: Math.hypot(a.x - b.x, a.y - b.y),
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        };
    }

    function onPointerDown(e) {
        if (!src) return;
        rect = canvas.getBoundingClientRect();
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, toLocal(e));
        if (pointers.size === 1) {
            panLast = toLocal(e);
            pinchPrev = null;
        } else if (pointers.size === 2) {
            pinchPrev = computePinch();
            panLast = null;
        }
    }

    function onPointerMove(e) {
        if (!src || !pointers.has(e.pointerId)) return;
        const p = toLocal(e);
        pointers.get(e.pointerId).x = p.x;
        pointers.get(e.pointerId).y = p.y;

        if (pointers.size === 1 && panLast) {
            px += p.x - panLast.x;
            py += p.y - panLast.y;
            panLast = p;
            clampPos();
            scheduleRender();
        } else if (pointers.size === 2 && pinchPrev) {
            const cur = computePinch();
            const ratio = (cur.dist > 0 && pinchPrev.dist > 0) ? cur.dist / pinchPrev.dist : 1;
            setZoom(z * ratio, cur.x, cur.y); // zoom about the current midpoint
            px += cur.x - pinchPrev.x;        // follow the two-finger drag
            py += cur.y - pinchPrev.y;
            clampPos();
            scheduleRender();
            pinchPrev = cur;
        }
    }

    function onPointerUp(e) {
        if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
        }
        pointers.delete(e.pointerId);
        if (pointers.size === 1) {
            // One finger lifted mid-pinch — rebase the pan baseline to avoid a jump.
            panLast = [...pointers.values()][0];
            pinchPrev = null;
        } else if (pointers.size === 0) {
            panLast = null;
            pinchPrev = null;
        }
    }

    function onWheel(e) {
        if (!src) return;
        e.preventDefault();
        rect = canvas.getBoundingClientRect();
        const anchor = toLocal(e);
        const factor = Math.exp(-e.deltaY * 0.0015); // smooth, direction-correct
        setZoom(z * factor, anchor.x, anchor.y);
    }

    function onKeyDown(e) {
        if (!src) return;
        let handled = true;
        switch (e.key) {
            case 'ArrowLeft':  px += KEY_PAN_STEP; break;
            case 'ArrowRight': px -= KEY_PAN_STEP; break;
            case 'ArrowUp':    py += KEY_PAN_STEP; break;
            case 'ArrowDown':  py -= KEY_PAN_STEP; break;
            case '+': case '=': setZoom(z * 1.1); return e.preventDefault();
            case '-': case '_': setZoom(z / 1.1); return e.preventDefault();
            case 'Escape':     e.preventDefault(); editorCancel.click(); return;
            default: handled = false;
        }
        if (handled) { e.preventDefault(); clampPos(); scheduleRender(); }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);
    zoomSlider.addEventListener('input', () => {
        if (src) setZoom(parseFloat(zoomSlider.value));
    });

    /**
     * Re-fit when the canvas's on-screen width actually changes (device rotation,
     * or the collapsible card re-expanding at a new width) — while PRESERVING the
     * user's framing: the natural pixel currently at the viewport centre stays
     * centred and the zoom is unchanged. A ResizeObserver fires only on real size
     * changes (not on the URL-bar / soft-keyboard resize events that plague mobile
     * `window.onresize`), and reports 0×0 when the card is collapsed (guarded).
     */
    function handleViewportResize() {
        if (!src || !editorReady || editor.hidden) return;
        const r = canvas.getBoundingClientRect();
        const newV = Math.round(r.width);
        if (!newV || newV === V) return; // collapsed (0) or unchanged → nothing to do
        // Natural pixel currently under the viewport centre (CSS-px space).
        const kOld = coverScale * z;
        const cnx = (V / 2 - px) / kOld;
        const cny = (V / 2 - py) / kOld;
        V = newV;
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.max(1, Math.round(V * dpr));
        canvas.height = Math.max(1, Math.round(V * dpr));
        coverScale = Math.max(V / Wn, V / Hn);
        const kNew = coverScale * z;
        px = V / 2 - cnx * kNew; // keep the same natural point centred
        py = V / 2 - cny * kNew;
        clampPos();
        render();
    }
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(handleViewportResize).observe(canvas);
    } else {
        window.addEventListener('resize', handleViewportResize);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Upload + card actions
    // ════════════════════════════════════════════════════════════════════════

    /** Upload a blob, update cache/preview/state, and notify other views. */
    async function commitUpload(blob) {
        if (awaitSession) await awaitSession;
        const url = await uploadAvatar(memberName, blob);
        currentUrl = url;
        lsSet(avatarCacheKey(memberName), url);
        paintAvatar(preview, url, memberName);
        syncButtons();
        document.dispatchEvent(new CustomEvent('myb:avatar-changed', {
            detail: { memberName, url },
        }));
    }

    // ── Choose ──
    chooseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = ''; // allow re-selecting the same file later
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setStatus('That file isn’t an image — please choose a photo.', true);
            return;
        }
        touched = true;
        setStatus('');
        let drawable;
        try {
            drawable = await fileToDrawable(file);
        } catch (e) {
            console.warn('[Avatar] read failed:', e);
            setStatus('Couldn’t read that image — try a different photo.', true);
            return;
        }
        // A decode can resolve with zero dimensions (corrupt file, SVG without an
        // intrinsic size) — drawImage would then save a blank JPEG silently.
        if (!drawable.width || !drawable.height) {
            if (typeof drawable.close === 'function') drawable.close();
            setStatus('Couldn’t read that image — try a different photo.', true);
            return;
        }
        openEditor(drawable);
    });

    // ── Editor Save (export → upload) ──
    editorSave.addEventListener('click', async () => {
        if (!src) return;
        editorSave.disabled = true;
        editorCancel.disabled = true;
        setStatus('Saving…');
        try {
            const blob = await exportBlob();
            await commitUpload(blob);
            closeEditor();
            setStatus('✓ Saved');
        } catch (e) {
            console.warn('[Avatar] save failed:', e);
            // Keep the editor open so the user can retry without re-framing.
            setStatus('Couldn’t save — check your connection and try again.', true);
        } finally {
            editorSave.disabled = false;
            editorCancel.disabled = false;
        }
    });

    // ── Editor Cancel (discard, restore saved photo) ──
    editorCancel.addEventListener('click', () => {
        closeEditor();
        paintAvatar(preview, currentUrl, memberName);
        setStatus('');
    });

    // ── Remove ──
    removeBtn?.addEventListener('click', async () => {
        touched = true;
        removeBtn.disabled = true;
        setStatus('Removing…');
        try {
            if (awaitSession) await awaitSession;
            await deleteAvatar(memberName);
            currentUrl = null;
            lsDel(avatarCacheKey(memberName));
            paintAvatar(preview, null, memberName);
            syncButtons();
            setStatus('✓ Photo removed');
            document.dispatchEvent(new CustomEvent('myb:avatar-changed', {
                detail: { memberName, url: null },
            }));
        } catch (e) {
            console.warn('[Avatar] remove failed:', e);
            setStatus('Couldn’t remove — check your connection and try again.', true);
        } finally {
            removeBtn.disabled = false;
        }
    });
}
