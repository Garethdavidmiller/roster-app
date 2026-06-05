/**
 * settings-avatar.js — Profile photo card for settings.html.
 *
 * Lets a staff member set a small profile picture that appears as a badge in the
 * nav-panel footer (and a larger preview here). The flow is deliberately simple:
 *   Choose photo → preview → Save  (or Remove to clear it).
 *
 * The image is cropped to a square and compressed to a ~256px JPEG entirely in
 * the browser (canvas) before upload, so the stored file is a few KB regardless
 * of the original camera photo size. Upload + Firestore pointer live in
 * firebase-client.js (uploadAvatar / deleteAvatar / fetchAvatarUrl).
 *
 * Cross-page sync: after a save/remove we cache the URL in localStorage (instant
 * paint elsewhere on this device) and dispatch a `myb:avatar-changed` event that
 * nav-panel.js listens for, so the footer badge updates without a reload.
 */

import { uploadAvatar, deleteAvatar, fetchAvatarUrl } from './firebase-client.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { avatarCacheKey, paintAvatar } from './avatar.js';

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
 * Centre-crop to a square and compress to a JPEG blob.
 * @param {File} file
 * @param {number} [size=256] output edge length in px
 * @param {number} [quality=0.82] JPEG quality 0–1
 * @returns {Promise<Blob>}
 */
async function compressToJpeg(file, size = 256, quality = 0.82) {
    const src = await fileToDrawable(file);
    const w = src.width, h = src.height;
    // A decode can resolve with zero dimensions (corrupt file, SVG without an
    // intrinsic size). drawImage would then produce a blank-but-valid JPEG that
    // saves silently — guard so the caller gets the "couldn't read" error instead.
    if (!w || !h) {
        if (typeof src.close === 'function') src.close();
        throw new Error('Image has no usable dimensions');
    }
    const min = Math.min(w, h);
    const sx = (w - min) / 2, sy = (h - min) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, sx, sy, min, min, 0, 0, size, size);
    if (typeof src.close === 'function') src.close(); // release ImageBitmap memory
    return await new Promise((resolve, reject) =>
        canvas.toBlob(
            b => b ? resolve(b) : reject(new Error('Could not process image')),
            'image/jpeg', quality
        ));
}

/**
 * Initialise the Profile photo card.
 * @param {{ memberName: string, awaitSession?: Promise<any>|null }} opts
 *   memberName   — the signed-in member.
 *   awaitSession — resolves when Firebase Auth is re-established; awaited before
 *                  any Storage/Firestore write so the request.auth rule passes.
 */
export function initAvatarCard({ memberName, awaitSession = null }) {
    const preview    = document.getElementById('avatarPreview');
    const chooseBtn  = document.getElementById('avatarChooseBtn');
    const removeBtn  = document.getElementById('avatarRemoveBtn');
    const fileInput  = document.getElementById('avatarFileInput');
    const pendingRow = document.getElementById('avatarPending');
    const saveBtn    = document.getElementById('avatarSaveBtn');
    const cancelBtn  = document.getElementById('avatarCancelBtn');
    const statusEl   = document.getElementById('avatarStatus');
    if (!preview || !chooseBtn || !fileInput || !memberName) return;

    let currentUrl   = null;   // the saved avatar URL (null = initials)
    let pendingBlob  = null;   // compressed blob awaiting save
    let pendingObjUrl = null;  // object URL for the pending preview (must be revoked)
    let touched      = false;  // user chose/saved/removed — the slow initial fetch must not override them

    function setStatus(msg, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('error', isError);
    }

    function clearPending() {
        if (pendingObjUrl) { URL.revokeObjectURL(pendingObjUrl); pendingObjUrl = null; }
        pendingBlob = null;
        if (pendingRow) pendingRow.style.display = 'none';
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
        try {
            pendingBlob = await compressToJpeg(file);
        } catch (e) {
            console.warn('[Avatar] compress failed:', e);
            setStatus('Couldn’t read that image — try a different photo.', true);
            return;
        }
        if (pendingObjUrl) URL.revokeObjectURL(pendingObjUrl);
        pendingObjUrl = URL.createObjectURL(pendingBlob);
        paintAvatar(preview, pendingObjUrl, memberName);
        if (pendingRow) pendingRow.style.display = '';
    });

    // ── Save ──
    saveBtn?.addEventListener('click', async () => {
        if (!pendingBlob) return;
        saveBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        setStatus('Saving…');
        try {
            if (awaitSession) await awaitSession;
            const url = await uploadAvatar(memberName, pendingBlob);
            currentUrl = url;
            lsSet(avatarCacheKey(memberName), url);
            clearPending();
            paintAvatar(preview, url, memberName);
            syncButtons();
            setStatus('✓ Saved');
            document.dispatchEvent(new CustomEvent('myb:avatar-changed', {
                detail: { memberName, url },
            }));
        } catch (e) {
            console.warn('[Avatar] save failed:', e);
            setStatus('Couldn’t save — check your connection and try again.', true);
        } finally {
            saveBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
        }
    });

    // ── Cancel (discard the pending choice, revert to saved) ──
    cancelBtn?.addEventListener('click', () => {
        clearPending();
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
