// @ts-check
/**
 * paycalc-transfer-card.js — the "Move Your Pay Data" card on paycalc.html.
 *
 * NAMING: deliberately NOT "Back up your pay data" (v19.18). That title sat two cards below
 * "Pay Rise Back Pay" in the same column and scanned as BACK PAY data — the owner read it as the
 * back-pay card on sight. "Back pay" is established vocabulary in this app, so a card title must
 * not start with "Back up". The word "backup" is still fine as a NOUN on the buttons and in the
 * filename, where nothing collides.
 *
 * Shortened again to "Move Your Pay Data" at v19.19 (owner): the interim "Save or Move Your Pay
 * Data" was the only title in the sidebar that ran long against its four siblings. The card does
 * serve two purposes and "Move" names only one — the durable purpose is the safety copy, not the
 * one-off migration — so the HINT carries it and must keep leading with "Keep a copy". Do not
 * reword that hint to be about moving only.
 *
 * Owns: the card's DOM, the file/clipboard plumbing, and the confirmations before a restore.
 * Does NOT own: the backup format or any import RULE — those are pure, in paycalc-transfer.js,
 *   so the decision to overwrite someone's pay history is testable without a browser.
 * Edit here for: the card's wording, buttons, or feedback states.
 *
 * ── THE RESTORE ORDER IS NOT ARBITRARY (moved here from CLAUDE.md's file tree, v20.11) ─────────
 *
 * A restore is a **REPLACE, never a merge** — a half-merged pay history is worse than either
 * version. Two things about how it does that are easy to "tidy" into a catastrophe:
 *
 * 1. **It WRITES FIRST, verifies by reading back, and only then removes the surplus.** The obvious
 *    wipe-then-write order is catastrophic here because `lsSet` SWALLOWS a storage error (ls.js
 *    does that deliberately, for iOS private mode). On a device that had stopped accepting writes,
 *    the wipe would succeed, the write would silently do nothing, and the member would be told
 *    "Restored" as their pay history vanished. A `try/catch` around `lsSet` is dead code — reading
 *    the values back is the only signal there is.
 *
 * 2. **Surplus keys are `lsDel`'d, not blanked.** A key set to `''` leaves a value the app would
 *    later try to parse, and a key the backup lacks must genuinely disappear or the "replace" is a
 *    merge wearing a replace's label.
 *
 * And every control is disabled when the member cannot be identified — **the paste pair included**,
 * whose omission once left one paste able to delete two members' pay history on a shared device.
 */

import { lsGet, lsSet, lsDel, lsKeys } from './ls.js';
import { pcPrefix, memberSlug } from './paycalc-migrations.js';
import { getLoggedMember } from './paycalc-settings.js';

/** The signed-in member's NAME — getLoggedMember returns the teamMembers object, or null. */
const memberName = () => getLoggedMember()?.name || '';

import { APP_VERSION } from './roster-data.js';
import { confirmDialog } from './overlay.js';
import {
    selectBackupKeys, buildBackup, validateBackup, rekeyEntries, backupFilename,
    applyRestore as applyStorageRestore,
} from './paycalc-transfer.js';
import { inventoryOf, inventoryLines } from './paycalc-inventory.js';

/**
 * How long the `#payTransferCard` deep link keeps WATCHING for the page to move under it.
 *
 * Not a delay before acting — the corrections happen the moment the page grows (see the deep-link
 * footer below); this is only when we stop listening. Watching costs nothing once the page has
 * settled, because a settled page fires no resizes, so this is sized for the slowest device rather
 * than the machine it was written on: growth was still arriving ~3s in on a desktop WebKit.
 *
 * ── "STOP WHEN THE PAGE GOES QUIET" WAS TRIED HERE, AND IT IS WORSE (v21.50) ────────────────────
 *
 * It is the obvious refinement — settling is a property of the page, so measure it from the last
 * thing that moved rather than from a clock — and it FAILED a third of the time where this passed
 * 12/12. The page does not grow continuously: it grows in BURSTS, and the gap between the first
 * layout and the big one is ~670ms, longer than any quiet window short enough to be worth having.
 * So the watch ended inside the gap, moments before the growth it existed for. Measured, not
 * reasoned about — and recorded because it is a natural idea to have twice.
 */
const DEEP_LINK_WATCH_MS = 4000;

/** Wire the card. Safe no-op when the page has no transfer card. */
export function initTransferCard() {
    const card = document.getElementById('payTransferCard');
    if (!card) return;

    const summaryEl = document.getElementById('ptSummary');
    const invEl     = document.getElementById('ptInventory');
    const statusEl  = document.getElementById('ptStatus');
    const saveEl    = document.getElementById('ptSaveStatus');
    const dlBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptDownload'));
    const copyBtn   = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptCopy'));
    const restoreBtn= /** @type {HTMLButtonElement|null} */ (document.getElementById('ptRestore'));
    const fileInput = /** @type {HTMLInputElement|null} */ (document.getElementById('ptFile'));
    const pasteBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptPasteGo'));
    const pasteText = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('ptPaste'));
    /** Every control that acts on pay data. The PASTE pair belongs here too — leaving it out is
     *  what left the destructive path live for an unidentifiable member (v19.17). */
    const allControls = [dlBtn, copyBtn, restoreBtn, pasteBtn, pasteText];

    /** Write one of the two feedback lines. Each half of the card has its own, because a
     *  confirmation that renders off the bottom of the screen is not a confirmation.
     *  @param {HTMLElement|null} el @param {string} msg @param {'ok'|'warn'|''} [tone] */
    function write(el, msg, tone = '') {
        if (!el) return;
        el.textContent = msg;
        el.className = 'pt-status' + (tone ? ` pt-status--${tone}` : '');
    }
    /** Feedback for the RESTORE half (the card's foot). @param {string} msg @param {'ok'|'warn'|''} [tone] */
    const status = (msg, tone = '') => write(statusEl, msg, tone);
    /** Feedback for the SAVE half, beside its own buttons. @param {string} msg @param {'ok'|'warn'|''} [tone] */
    const saveStatus = (msg, tone = '') => write(saveEl, msg, tone);

    /** "1 payslip" / "2 payslips" — the restore messages state a count the member reads back to us.
     *  @param {number} n @param {string} word */
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    /** Current member's keys, or [] when signed out (the namespace would be wrong). */
    function ownKeys() {
        return selectBackupKeys(lsKeys(), pcPrefix());
    }

    /** Render an inventory as the card's detail list. @param {string[]} lines */
    function paintInventory(lines) {
        if (!invEl) return;
        invEl.textContent = '';
        invEl.hidden = !lines.length;
        for (const line of lines) {
            const li = document.createElement('li');
            li.textContent = line;
            invEl.appendChild(li);
        }
    }

    function refreshSummary() {
        const member = memberName();
        if (!summaryEl) return;
        if (!member) {
            // The page's own session guard means somebody IS signed in — so this is the narrower
            // case of a session name that is no longer on the roster (a leaver, a rename). The
            // per-member namespace never activates for such a session, so `pcPrefix()` is the bare
            // `myb_pc_` and every control here would operate across EVERY member on the device.
            // Say what is actually wrong rather than "sign in", which they already have.
            summaryEl.textContent = "This device can't tell whose pay data is saved here, so saving and "
                + 'restoring are turned off. Contact the admin.';
            paintInventory([]);
            allControls.forEach(b => { if (b) b.disabled = true; });
            return;
        }
        allControls.forEach(b => { if (b) b.disabled = false; });
        const keys = ownKeys();
        if (!keys.length) {
            summaryEl.textContent = 'Nothing saved on this device yet.';
            paintInventory([]);
            if (dlBtn) dlBtn.disabled = true;
            if (copyBtn) copyBtn.disabled = true;
            return;
        }
        // ITEMISE, don't total (v22.14, external review). The old single line — "N payslips across
        // M tax years, plus your settings" — was the whole answer this card gave to "what am I
        // about to carry to my new phone?", and "your settings" silently stood for the pension
        // timeline, the back-pay figures, the Year-to-Date totals and the payslip comparison. A
        // member checking whether their old tax year is in there could not tell, and the count
        // itself was under-reading years (see summarise in paycalc-transfer.js).
        // "On this device", not "Saved on this device" — under a SAVE A COPY heading the past
        // tense reads as "already backed up", which is the opposite of what the list means.
        summaryEl.textContent = 'On this device:';
        paintInventory(inventoryLines(inventoryOf(keys, pcPrefix())));
    }

    /** Serialise the current member's data. @returns {{text: string, name: string}|null} */
    function makeBackup() {
        const member = memberName();
        const keys = ownKeys();
        if (!keys.length) return null;
        /** @type {Record<string,string>} */
        const entries = {};
        for (const k of keys) {
            const v = lsGet(k);
            if (v !== null) entries[k] = v;
        }
        const exportedAt = new Date().toISOString();
        const blob = buildBackup({
            entries, member, slug: memberSlug(member),
            appVersion: APP_VERSION, exportedAt, prefix: pcPrefix(),
        });
        return { text: JSON.stringify(blob, null, 2), name: backupFilename(member, exportedAt) };
    }

    dlBtn?.addEventListener('click', () => {
        const b = makeBackup();
        if (!b) { saveStatus('There is nothing to save yet.', 'warn'); return; }
        const url = URL.createObjectURL(new Blob([b.text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = b.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can cancel the download on some Android builds — give it a moment.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        // NAME THE FILE, DON'T RE-ARGUE THE WARNING (v19.86 for the warning; trimmed v22.14). The
        // full "readable text holding your pay figures" statement is now the paragraph directly
        // above the button, ~100px away, so repeating it here was the card saying one fact twice
        // in one glance — the thing the v18.48 back-pay pass exists to stop. What this line has to
        // add is the FILENAME, which the paragraph cannot know, plus the one-clause reminder of
        // how to treat it.
        saveStatus(`Saved as ${b.name} — treat that file like a payslip.`, 'ok');
    });

    copyBtn?.addEventListener('click', async () => {
        const b = makeBackup();
        if (!b) { saveStatus('There is nothing to save yet.', 'warn'); return; }
        try {
            await navigator.clipboard.writeText(b.text);
            // The clipboard deserves the SHARPER warning of the two: clipboard history and
            // cross-device sync (Windows, Android, iCloud) can retain it well after the paste, on
            // machines the member never thought about.
            saveStatus('Copied. Paste it into the Restore box on the new web address, then copy something '
                 + 'else — this is your pay data in readable text and some devices keep clipboard history.', 'ok');
        } catch {
            saveStatus("Couldn't copy — use Download backup instead.", 'warn');
        }
    });

    restoreBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';                   // so re-picking the same file fires again
        if (!file) return;
        /** @type {string} */
        let text;
        try { text = await file.text(); }
        catch { status("Couldn't read that file.", 'warn'); return; }
        await applyRestore(text);
    });

    /** The confirmation ladder, then the write. @param {string} text */
    async function applyRestore(text) {
        const member = memberName();
        // Belt-and-braces alongside the disabled controls above: validateBackup fails closed on an
        // empty slug too, so this path is refused twice over rather than once.
        const res = validateBackup(text, { currentSlug: memberSlug(member) });
        if (!res.ok) { status(res.error, 'warn'); return; }

        if (res.unnamespaced) {
            const ok = await confirmDialog({
                title: 'Whose backup is this?',
                message: 'This backup was made before the app recorded who saved it. Restore it as your pay data?',
                confirmLabel: 'Restore as mine',
            });
            if (!ok) { status('Nothing was changed.'); return; }
        }

        // SAY WHAT IS DAMAGED BEFORE THEY AGREE, and let them agree anyway (v22.14, external
        // review). The preflight parses only the entries that are supposed to be JSON; anything it
        // cannot read will restore faithfully and then fail to open. Refusing the whole file was
        // the reviewer's suggestion and is the wrong call here — see damagedEntries — because a
        // backup is routinely the only copy left, so refusing hands the member nothing at all.
        const damagedNote = res.damaged.length
            ? `\n\n${plural(res.damaged.length, 'saved figure')} in this backup ${res.damaged.length === 1 ? 'is' : 'are'} `
              + `damaged and will not open after restoring (${res.damaged.map(d => d.label).slice(0, 4).join(', ')}`
              + `${res.damaged.length > 4 ? ', and more' : ''}). Everything else will restore normally.`
            : '';

        // Replace, never merge — a half-merged pay history is worse than either version.
        //
        // NAME BOTH SIDES. Until v22.14 this dialog stated one number about the incoming file
        // ("the 12 payslips in the backup will take over") and NOTHING about what was being
        // destroyed, which is the half the member is actually deciding about — and the payslip
        // count alone described neither side, since a namespace also holds pension history,
        // back-pay figures and Year-to-Date totals that no payslip count mentions.
        const existing = ownKeys();
        const arriving = inventoryLines(res.inventory).map(l => `• ${l}`).join('\n');
        if (existing.length) {
            const here = inventoryLines(inventoryOf(existing, pcPrefix())).map(l => `• ${l}`).join('\n');
            const ok = await confirmDialog({
                title: 'Replace your pay data?',
                // THE DECISION LEADS, THE DETAIL FOLLOWS. The message can genuinely outgrow the
                // dialog — it is capped at 86vh and scrolls (shared.css) — and the first draft
                // put the two sentences that matter, the consequence and the damage warning,
                // BELOW the two inventories and therefore below the fold on a 640px phone. A
                // member could reach Replace without ever seeing them. Detail may be scrolled
                // to; a consequence may not.
                message: 'Restoring replaces what is here — anything on this device that is not in '
                       + `the backup will be lost.${damagedNote}\n\n`
                       + `The backup holds:\n${arriving}\n\nThis device currently holds:\n${here}`,
                confirmLabel: 'Replace',
                danger: true,
            });
            if (!ok) { status('Nothing was changed.'); return; }
        } else if (damagedNote) {
            // Nothing to lose, but the damage still has to be said before it is written.
            const ok = await confirmDialog({
                title: 'Some of this backup is damaged',
                message: `${damagedNote.trimStart()}\n\nThe backup holds:\n${arriving}`,
                confirmLabel: 'Restore anyway',
            });
            if (!ok) { status('Nothing was changed.'); return; }
        }

        // The whole ladder is `applyRestore` in paycalc-transfer.js (v19.84). It used to be inline
        // here and snapshotted only the keys that ALREADY EXISTED, so a rollback could not undo a
        // key the backup had CREATED — leaving a half-merged pay history while telling the member
        // nothing had changed. The rules now work over the UNION of both sides and are tested
        // against a storage that fails on demand, which a browser will not do to order.
        const entries = rekeyEntries(res.blob.data, res.blob.slug || '', memberSlug(member));
        const outcome = applyStorageRestore({ get: lsGet, set: lsSet, del: lsDel, existing, entries });

        if (!outcome.ok) {
            if (outcome.reason === 'surplus-remains') {
                // The new data landed but the old data would not go. That is a MERGE, not the
                // replace the member agreed to, so it must not be reported as success.
                status('Your backup was written, but some of the old pay data on this device could not be '
                     + 'removed, so both are now present. Free up some space and restore again.', 'warn');
                return;
            }
            status(outcome.restored
                ? "This device's storage refused the restore, so nothing was changed. Free up some space on the "
                  + 'phone and try again — your backup is still fine.'
                : "This device's storage refused the restore, and some of what was here could not be put back. "
                  + 'Keep your backup and contact the admin.', 'warn');
            return;
        }

        status(`Restored ${plural(res.counts.periods, 'payslip')}. Reloading…`, 'ok');
        setTimeout(() => window.location.reload(), 800);
    }

    // Paste path — same ladder, different source.
    pasteBtn?.addEventListener('click', async () => {
        const t = pasteText?.value.trim();
        if (!t) { status('Paste a backup into the box first.', 'warn'); return; }
        await applyRestore(t);
    });

    refreshSummary();

    // Settings points here with `#payTransferCard`. The card is collapsed by default, so a bare
    // fragment jump would land the member on a closed header — expand it and re-scroll, because the
    // browser's own fragment scroll has already happened by the time this runs.
    if (window.location.hash === '#payTransferCard') {
        const body = document.getElementById('payTransferBody');
        if (body && !body.classList.contains('open')) {
            document.getElementById('payTransferToggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        card.scrollIntoView({ block: 'start' });

        // ── THE PAGE IS NOT FINISHED WHEN THIS RUNS, AND THAT IS THE WHOLE PROBLEM ──────────────
        //
        // Measured on WebKit at 390×844: the document is ~2,230px tall when the line above runs and
        // ~4,750px a second later — the period band, the roster hint bar and the result card all
        // arrive late. So that scroll hits the bottom of a page too short to put the card at the
        // top and leaves it at y=1578; only a LATER scroll can finish the job.
        //
        // Until v21.50 the later scroll was a single `setTimeout(…, 400)`, and a fixed delay is a
        // RACE against a growth whose timing nothing controls: land after the growth and the card
        // reaches y=45, land before it and the correction is a no-op against a page that has not
        // grown yet — after which nothing tries again and the card sits at 1578 for good. Sampled
        // every frame for three seconds, it lost that race about a third of the time in a real
        // browser (and every time on CI's slower runner).
        //
        // So the correction follows the GROWTH instead of guessing when it will end. A
        // ResizeObserver on <body> fires exactly when the layout that moves the card changes,
        // however slow the device, and costs nothing on a page that has settled. Repeated
        // corrections are free: scrolling to a card already at the top is a no-op.
        //
        // The cancel signal is a real GESTURE, not a scrollY delta. A delta guard looks obvious and
        // does not work here: growing content above the card makes the browser's own scroll
        // anchoring move scrollY, so the guard reads that as "the member scrolled" and suppresses
        // the very correction it exists to allow. (Measured — the delta version left it at y=681.)
        // Yanking the page under someone already reading is worse than landing low, so the first
        // gesture stops the corrections for good — as does the end of the watch window.
        let userMoved = false;
        /** @type {ResizeObserver | null} */ let observer = null;
        /** @type {any} */ let watch = null;
        const gestures = ['wheel', 'touchstart', 'keydown'];
        const stop = () => {
            gestures.forEach(e => window.removeEventListener(e, mark));
            observer?.disconnect();
            observer = null;
            clearTimeout(watch);
        };
        function mark() { userMoved = true; stop(); }
        const correct = () => { if (!userMoved) card.scrollIntoView({ block: 'start' }); };

        gestures.forEach(e => window.addEventListener(e, mark, { passive: true, once: true }));
        watch = setTimeout(stop, DEEP_LINK_WATCH_MS);
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(correct);
            observer.observe(document.body);
        } else {
            // No observer: the pre-v21.50 single retry. It is what those devices already had, and
            // it is still better than never correcting at all.
            setTimeout(correct, 400);
        }
    }
}
