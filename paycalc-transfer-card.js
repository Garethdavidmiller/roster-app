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
 */

import { lsGet, lsSet, lsDel, lsKeys } from './ls.js';
import { pcPrefix, memberSlug } from './paycalc-migrations.js';
import { getLoggedMember } from './paycalc-settings.js';

/** The signed-in member's NAME — getLoggedMember returns the teamMembers object, or null. */
const memberName = () => getLoggedMember()?.name || '';
import { APP_VERSION } from './roster-data.js';
import { confirmDialog } from './overlay.js';
import {
    selectBackupKeys, summarise, buildBackup, validateBackup, rekeyEntries, backupFilename,
    applyRestore as applyStorageRestore,
} from './paycalc-transfer.js';

/** Wire the card. Safe no-op when the page has no transfer card. */
export function initTransferCard() {
    const card = document.getElementById('payTransferCard');
    if (!card) return;

    const summaryEl = document.getElementById('ptSummary');
    const statusEl  = document.getElementById('ptStatus');
    const dlBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptDownload'));
    const copyBtn   = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptCopy'));
    const restoreBtn= /** @type {HTMLButtonElement|null} */ (document.getElementById('ptRestore'));
    const fileInput = /** @type {HTMLInputElement|null} */ (document.getElementById('ptFile'));
    const pasteBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptPasteGo'));
    const pasteText = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('ptPaste'));
    /** Every control that acts on pay data. The PASTE pair belongs here too — leaving it out is
     *  what left the destructive path live for an unidentifiable member (v19.17). */
    const allControls = [dlBtn, copyBtn, restoreBtn, pasteBtn, pasteText];

    /** @param {string} msg @param {'ok'|'warn'|''} [tone] */
    function status(msg, tone = '') {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = 'pt-status' + (tone ? ` pt-status--${tone}` : '');
    }

    /** "1 payslip" / "2 payslips" — the restore messages state a count the member reads back to us.
     *  @param {number} n @param {string} word */
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    /** Current member's keys, or [] when signed out (the namespace would be wrong). */
    function ownKeys() {
        return selectBackupKeys(lsKeys(), pcPrefix());
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
            allControls.forEach(b => { if (b) b.disabled = true; });
            return;
        }
        allControls.forEach(b => { if (b) b.disabled = false; });
        const keys = ownKeys();
        if (!keys.length) {
            summaryEl.textContent = 'Nothing saved on this device yet.';
            if (dlBtn) dlBtn.disabled = true;
            if (copyBtn) copyBtn.disabled = true;
            return;
        }
        // Say what is actually here. A flat "N payslips across M tax years" reads as "0 payslips
        // across 1 tax year" for someone who has only ever opened the back-pay card — the first
        // line of a card whose whole job is to tell you what you would be backing up.
        const s = summarise(keys, pcPrefix());
        let what;
        if (s.periods && s.taxYears)  what = `${plural(s.periods, 'payslip')} across ${plural(s.taxYears, 'tax year')}`;
        else if (s.periods)           what = plural(s.periods, 'payslip');
        else if (s.taxYears)          what = `${plural(s.taxYears, 'tax year')} of figures`;
        summaryEl.textContent = what
            ? `On this device: ${what}, plus your settings.`
            : 'On this device: your settings. No payslip figures saved yet.';
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
        if (!b) { status('There is nothing to save yet.', 'warn'); return; }
        const url = URL.createObjectURL(new Blob([b.text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = b.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can cancel the download on some Android builds — give it a moment.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        // SAY WHAT IS IN THE FILE (v19.86, external review P3). "Keep it somewhere you can find it" is
        // filing advice; this is a readable JSON file containing pay, hours, pension, tax code and
        // year-to-date figures, and a member who does not know that has no reason to treat it
        // carefully — emailing it to themselves is the obvious thing to do next.
        status(`Saved as ${b.name}. It contains your pay figures in readable text — keep it private, `
             + 'don\u2019t send it to anyone, and delete old copies.', 'ok');
    });

    copyBtn?.addEventListener('click', async () => {
        const b = makeBackup();
        if (!b) { status('There is nothing to save yet.', 'warn'); return; }
        try {
            await navigator.clipboard.writeText(b.text);
            // The clipboard deserves the SHARPER warning of the two: clipboard history and
            // cross-device sync (Windows, Android, iCloud) can retain it well after the paste, on
            // machines the member never thought about.
            status('Copied. Paste it into the Restore box on the new web address, then copy something '
                 + 'else — this is your pay data in readable text and some devices keep clipboard history.', 'ok');
        } catch {
            status("Couldn't copy — use Download backup instead.", 'warn');
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

        // Replace, never merge — a half-merged pay history is worse than either version.
        const existing = ownKeys();
        if (existing.length) {
            const ok = await confirmDialog({
                title: 'Replace your pay data?',
                message: `You already have pay data on this device. Restoring will replace it — the `
                       + `${plural(res.counts.periods, 'payslip')} in the backup will take over, and anything you `
                       + 'have entered here will be lost.',
                confirmLabel: 'Replace',
                danger: true,
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
        // Scrolling once is not enough: the calculator keeps laying out after this runs (the period
        // band, the roster hint bar and the result card all resize), so the card drifts back down —
        // measured landing at y=681 of an 844px viewport, with 605px of scroll still available.
        // Re-scroll once things have settled, unless the member has started scrolling themselves;
        // yanking the page under someone already reading is worse than landing low.
        //
        // The cancel signal is a real GESTURE, not a scrollY delta. A delta guard looks obvious and
        // does not work here: growing content above the card makes the browser's own scroll
        // anchoring move scrollY, so the guard reads that as "the member scrolled" and suppresses
        // the very correction it exists to allow. (Measured — the delta version left it at y=681.)
        let userMoved = false;
        const mark = () => { userMoved = true; };
        const opts = { passive: true, once: true };
        ['wheel', 'touchstart', 'keydown'].forEach(e => window.addEventListener(e, mark, opts));
        setTimeout(() => {
            ['wheel', 'touchstart', 'keydown'].forEach(e => window.removeEventListener(e, mark));
            if (!userMoved) card.scrollIntoView({ block: 'start' });
        }, 400);
    }
}
