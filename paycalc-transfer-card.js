// @ts-check
/**
 * paycalc-transfer-card.js — the "Back up your pay data" card on paycalc.html.
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

    /** @param {string} msg @param {'ok'|'warn'|''} [tone] */
    function status(msg, tone = '') {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = 'pt-status' + (tone ? ` pt-status--${tone}` : '');
    }

    /** Current member's keys, or [] when signed out (the namespace would be wrong). */
    function ownKeys() {
        return selectBackupKeys(lsKeys(), pcPrefix());
    }

    function refreshSummary() {
        const member = memberName();
        if (!summaryEl) return;
        if (!member) {
            summaryEl.textContent = 'Sign in to back up your pay data.';
            [dlBtn, copyBtn, restoreBtn].forEach(b => { if (b) b.disabled = true; });
            return;
        }
        [dlBtn, copyBtn, restoreBtn].forEach(b => { if (b) b.disabled = false; });
        const keys = ownKeys();
        if (!keys.length) {
            summaryEl.textContent = 'Nothing saved on this device yet.';
            if (dlBtn) dlBtn.disabled = true;
            if (copyBtn) copyBtn.disabled = true;
            return;
        }
        const s = summarise(keys, pcPrefix());
        const bits = [`${s.periods} payslip${s.periods === 1 ? '' : 's'}`];
        if (s.taxYears) bits.push(`${s.taxYears} tax year${s.taxYears === 1 ? '' : 's'}`);
        summaryEl.textContent = `On this device: ${bits.join(' across ')}, plus your settings.`;
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
        if (!b) { status('There is nothing to back up yet.', 'warn'); return; }
        const url = URL.createObjectURL(new Blob([b.text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = b.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can cancel the download on some Android builds — give it a moment.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        status(`Saved as ${b.name}. Keep it somewhere you can find it.`, 'ok');
    });

    copyBtn?.addEventListener('click', async () => {
        const b = makeBackup();
        if (!b) { status('There is nothing to back up yet.', 'warn'); return; }
        try {
            await navigator.clipboard.writeText(b.text);
            status('Copied. Paste it into the Restore box on the other address.', 'ok');
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
        if (ownKeys().length) {
            const ok = await confirmDialog({
                title: 'Replace your pay data?',
                message: `You already have pay data on this device. Restoring will replace it — the ${res.counts.periods} `
                       + 'payslip figures in the backup will take over, and anything you have entered here will be lost.',
                confirmLabel: 'Replace',
                danger: true,
            });
            if (!ok) { status('Nothing was changed.'); return; }
            // REMOVE, don't blank. Setting a key to '' leaves a value the app would later try to
            // parse — an empty period reads as corrupt, not as absent. And a key the backup does
            // not contain must genuinely disappear, or the restore is a merge wearing a replace's
            // label: the member would be left with figures from a payslip they thought they'd
            // replaced.
            for (const k of ownKeys()) lsDel(k);
        }

        const entries = rekeyEntries(res.blob.data, res.blob.slug || '', memberSlug(member));
        let written = 0;
        try {
            for (const [k, v] of Object.entries(entries)) { lsSet(k, v); written++; }
        } catch {
            // localStorage cannot be written atomically, so report honestly rather than claim success.
            status(`Storage stopped accepting data after ${written} of ${Object.keys(entries).length} items. `
                 + 'Your pay data may be incomplete — restore again, or contact the admin.', 'warn');
            return;
        }
        status(`Restored ${res.counts.periods} payslips. Reloading…`, 'ok');
        setTimeout(() => window.location.reload(), 800);
    }

    // Paste path — same ladder, different source.
    const pasteBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('ptPasteGo'));
    const pasteText = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('ptPaste'));
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
    }
}
