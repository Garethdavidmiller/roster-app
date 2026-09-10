// @ts-check
/**
 * select-sheet.js — the app's designed replacement for a native `<select>` popup.
 *
 * WHY THIS EXISTS, and why it is not a new idea: `date-picker.js` already made this
 * exact argument about `<input type="date">` — "the internal glyph/popup are drawn by
 * the browser and can't be themed — the one off-brand spot in an app that custom-styles
 * every other field." Every word of that is true of `<select>` too, and the decision
 * simply never got carried across. It cost nothing on a desktop, where a select's popup
 * is a tidy grouped list; it costs the whole design on Android, where the popup is a
 * full-bleed Material radio sheet with its own type scale, and a ~50-name roster then
 * arrives as fifty oversized rows with no grouping the app can influence.
 *
 * PROGRESSIVE ENHANCEMENT, NOT A REWRITE — the same contract date-picker.js keeps:
 *   The native `<select>` STAYS IN THE DOM as the value holder. Every consumer keeps
 *   working untouched: code that reads `.value`, rebuilds `.options`, or listens for
 *   `change` is unaffected, because picking a row sets `select.value` and dispatches
 *   `input` + `change` exactly as a user's own choice would. That is what makes this
 *   safe to apply to controls as load-bearing as "whose roster am I reading".
 *
 * THE OPTIONS ARE READ ON EVERY OPEN, never cached. Half these selects are populated by
 * JavaScript after boot (the member lists from `teamMembers`, the period list from the
 * pay grid) and several are rebuilt when something else changes. A snapshot taken at
 * enhancement time would be a list of the wrong names, and it would be wrong silently.
 *
 * ACCESSIBILITY: the select is removed from the a11y tree (`aria-hidden`, `tabindex=-1`)
 * and the trigger button carries the name — otherwise a screen reader would find two
 * controls for one value, one of them unreachable. The sheet is a `createLightbox`
 * dialog of plain `<button>` rows, so Tab, Escape, the focus trap and Android Back all
 * come from the canonical lifecycle; `aria-current` plus a tick marks the chosen row, so
 * it never rests on colour alone. No `role="listbox"` machinery is needed or wanted.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not restyle the closed control. The trigger
 * takes the classes the page already gives its fields, so each page keeps its own field
 * design and this module owns only the popup — the part that was never ours before.
 *
 * TWO ENTRY POINTS, ONE SHEET (v23.38): `enhanceSelect` for a control backed by a real
 * `<select>`, `openOptionSheet` for a caller that holds the value itself — the Links grid's
 * cell editor, whose control is a grid cell. The second is the first's own popup, lifted out
 * rather than copied, so there is still exactly one dropdown in this app.
 *
 * `createLightbox` is INJECTED rather than imported, for the reason links-design-header.js
 * injects it: `overlay.js` touches `window` at import, and a module that cannot load in Node
 * cannot have its readers unit-tested. The first caller to supply it wins and it is remembered,
 * so the second and third enhanced select on a page need not repeat themselves.
 */

/** @type {((opts: any) => { open: () => void, close: () => (Promise<void>|void) })|null} */
let _createLightbox = null;

/** @typedef {{ value: string, label: string, meta: string, disabled: boolean }} SheetOption */
/** @typedef {{ label: string, options: SheetOption[] }} SheetGroup */

/**
 * Read a `<select>` into the grouped shape the sheet renders. Pure with respect to the
 * document — it only walks the element handed to it, so a fake DOM drives it in Node.
 *
 * `<optgroup>` becomes a titled group; ungrouped options become one untitled group, and
 * the two can coexist (the member selects put "—" separators and real names side by side).
 * An option's `data-meta` becomes its second line.
 * @param {any} select
 * @returns {SheetGroup[]}
 */
export function readGroups(select) {
    const groups = /** @type {SheetGroup[]} */ ([]);
    let loose = /** @type {SheetGroup|null} */ (null);
    const opt = (/** @type {any} */ o) => ({
        value: String(o.value ?? ''),
        label: String(o.textContent ?? '').trim(),
        meta: String(o.dataset?.meta ?? ''),
        disabled: !!o.disabled,
    });
    for (const child of Array.from(select.children || [])) {
        const el = /** @type {any} */ (child);
        const tag = String(el.tagName || '').toUpperCase();
        if (tag === 'OPTGROUP') {
            loose = null;
            groups.push({ label: String(el.label ?? ''), options: Array.from(el.children || []).map(opt) });
        } else if (tag === 'OPTION') {
            if (!loose) { loose = { label: '', options: [] }; groups.push(loose); }
            loose.options.push(opt(el));
        }
    }
    return groups.filter(g => g.options.length > 0);
}

/**
 * The label the trigger should show: the selected option's text, or a placeholder when
 * the select is empty. Never the raw value — a value is an id, and this is a face.
 * @param {any} select
 * @param {string} [placeholder]
 * @returns {string}
 */
export function triggerLabel(select, placeholder = 'Choose…') {
    const list = select?.options ? Array.from(select.options) : [];
    const chosen = /** @type {any} */ (list[select.selectedIndex]);
    const text = String(chosen?.textContent ?? '').trim();
    return text || placeholder;
}

/**
 * The LONGEST label the select could show — what the trigger is sized to, so its width does not
 * move when the value does. Reads the same option text `triggerLabel` does, from the same list,
 * so the two can never disagree about what a row says.
 *
 * Longest by CHARACTER COUNT, which is an approximation and a deliberate one: the exact answer is
 * a text measurement per option in the trigger's own font, and it would have to be redone on every
 * font load, text-scale change and rebuild. The names, periods and grades these selects hold are
 * one typeface at one size, where character count and rendered width agree closely enough that the
 * control stops moving — which is the whole ask. The `max-width` cap catches any case where it
 * does not, exactly as it did for the native select.
 * @param {any} select
 * @param {string} [placeholder]
 * @returns {string}
 */
export function widestOptionLabel(select, placeholder = 'Choose…') {
    const list = select?.options ? Array.from(select.options) : [];
    let widest = '';
    for (const o of list) {
        const text = String(/** @type {any} */ (o)?.textContent ?? '').trim();
        if (text.length > widest.length) widest = text;
    }
    // No options yet (they arrive after boot on half these controls) — the placeholder is what the
    // face is showing, so sizing to it is the honest answer rather than collapsing to nothing.
    return widest || placeholder;
}

/** Build one option row. Mirrors the Links picker's rows so the two read as one control. */
function optionRow(/** @type {SheetOption} */ o, /** @type {boolean} */ current) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = current ? 'picker-opt is-current' : 'picker-opt';
    b.dataset.value = o.value;
    if (current) b.setAttribute('aria-current', 'true');
    if (o.disabled) b.disabled = true;
    const text = document.createElement('span');
    text.className = 'picker-opt-text';
    const n = document.createElement('span');
    n.className = 'picker-opt-name';
    n.textContent = o.label;
    text.appendChild(n);
    if (o.meta) {
        const m = document.createElement('small');
        m.textContent = o.meta;
        text.appendChild(m);
    }
    const tick = document.createElement('span');
    tick.className = 'picker-opt-tick';
    tick.setAttribute('aria-hidden', 'true');
    tick.textContent = current ? '✓' : '';
    b.append(text, tick);
    return b;
}

/** @typedef {{ overlay: HTMLElement, lb: { open: () => void, close: () => (Promise<void>|void) }, title: HTMLElement, sub: HTMLElement, list: HTMLElement }} Sheet */
/** The one sheet every enhanced select on a page shares. Built on first use.
 *  @type {Sheet|null} */
let _sheet = null;
function ensureSheet() {
    if (_sheet) return _sheet;
    if (!_createLightbox) return null;   // no factory, no sheet — the trigger simply does nothing
    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay picker-sheet-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Choose an option');
    const content = document.createElement('div');
    content.className = 'lb-content picker-sheet';
    const close = document.createElement('button');
    close.className = 'lb-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    const head = document.createElement('div');
    head.className = 'picker-head';
    const title = document.createElement('b');
    const sub = document.createElement('span');
    head.append(title, sub);
    const list = document.createElement('div');
    list.className = 'picker-list';
    content.append(close, head, list);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    const lb = _createLightbox({ overlay, content, closeBtn: close });
    _sheet = { overlay, lb, title, sub, list };
    return _sheet;
}

/**
 * Enhance one `<select>`. Returns a `refresh()` the caller can use when it has rebuilt
 * the options itself and wants the trigger's face brought back into step immediately
 * (the `change` listener already covers the ordinary case).
 * @param {HTMLSelectElement|null} select
 * @param {{ title?: string, placeholder?: string, triggerClass?: string,
 *           createLightbox?: (opts: any) => { open: () => void, close: () => (Promise<void>|void) } }} [opts]
 */
export function enhanceSelect(select, opts = {}) {
    if (opts.createLightbox) _createLightbox = opts.createLightbox;
    if (!select || select.dataset.sheetEnhanced) return () => {};
    select.dataset.sheetEnhanced = '1';

    const title = opts.title || select.getAttribute('data-sheet-title') || 'Choose an option';
    const btn = document.createElement('button');
    btn.type = 'button';
    // The trigger inherits the page's OWN field classes, so each page keeps its field
    // design and this module owns only the popup.
    btn.className = `${select.className} fieldpick ${opts.triggerClass || ''}`.trim();
    btn.setAttribute('aria-haspopup', 'dialog');
    if (select.id) btn.id = `${select.id}Trigger`;

    const face = document.createElement('span');
    face.className = 'fieldpick-face';
    // THE SIZER — why the trigger is not allowed to size itself to the name it is showing.
    //
    // A `<select>` takes its intrinsic width from its WIDEST option, so the control is the same
    // width whoever is selected. A button sizes to its own text, so from v23.33 the Calendar's
    // name picker changed width as you switched member and the whole control row re-centred
    // around it — the arrows moving in and out under your thumb. That was recorded in index.css
    // as "the change not a regression"; the owner's call is that consistency is the point
    // (9 Sep 2026), and they are right: a control that resizes when its VALUE changes is not the
    // control this replaced.
    //
    // So the button carries a hidden copy of the widest option and is laid out as a grid with
    // both children in the same cell — its intrinsic width is then the max of the two, which is
    // the widest option, which is what a `<select>` does. No percentage anywhere: index.css's
    // own comment is the record of a percentage width against a shrink-to-fit parent being the
    // cyclic case Chromium resolves as `none`, throwing the `max-width` cap away. The cap still
    // applies here, and the face still ellipsises under it.
    const sizer = document.createElement('span');
    sizer.className = 'fieldpick-sizer';
    sizer.setAttribute('aria-hidden', 'true');
    btn.append(face, sizer);

    const paint = () => {
        const label = triggerLabel(select, opts.placeholder);
        face.textContent = label;
        // Re-measured on every paint, not once: half these selects are populated after boot and
        // several are rebuilt, so a width taken at enhancement time would be the width of a list
        // that no longer exists.
        sizer.textContent = widestOptionLabel(select, opts.placeholder);
        btn.setAttribute('aria-label', `${title}. ${label}`);
        btn.disabled = select.disabled || select.options.length === 0;
    };

    select.parentNode?.insertBefore(btn, select);
    // The select stays as the value holder, out of the layout and out of the a11y tree.
    select.classList.add('fieldpick-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    // A consumer may normalise the value it was given (the roster upload snaps a date, the
    // member select falls back to a default). Re-painting on `change` means the face shows
    // what the select ACTUALLY holds, never what we asked it to hold.
    select.addEventListener('change', paint);
    // AND on `input`, which is the OTHER half of what a user's own pick fires — and the only
    // signal a PROGRAMMATIC selection can give us. `option.selected = true` and `selectedIndex = n`
    // change what the select holds while mutating NO attribute (`selected` is not reflected to the
    // content attribute) and firing NO event, so neither the listener above nor the observer below
    // can see them. That is not a hypothetical shape: both pages that carry an optgroup'd select
    // have a helper built on it — `_setSelectPeriod` (paycalc-periods.js) and `_setSelectValue`
    // (admin-app.js) — because iOS Safari ignores `.value` on a select with `<optgroup>`s. Those
    // helpers now say so by dispatching `input`; this is the ear for it.
    select.addEventListener('input', paint);
    // AND on any rebuild or disable, because those do NOT fire `change`. Half these selects are
    // repopulated after boot and several are disabled by an access change; without this the face
    // keeps a name that is no longer in the list, or offers a control the page has just switched
    // off — both silent, and both would be somebody else's bug to find. An observer rather than a
    // call at each site: the promise this module makes is that consumers do not change, and a
    // consumer that has to remember to call `refresh()` is a consumer that has changed.
    if (typeof MutationObserver === 'function') {
        new MutationObserver(paint).observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    }
    paint();

    btn.addEventListener('click', () => {
        openOptionSheet({
            title,
            groups: readGroups(select),
            current: select.value,
            // THE FACE MOVES ON THE TAP (v23.61). The value below waits for the sheet's close to land,
            // so with nothing here the trigger kept the old name for the whole fade and the pick
            // read as laggy. The face is shown the chosen row's own label the instant it is tapped;
            // `paint()` then repaints from the select on `input`, so if a consumer normalises the
            // value (the roster upload snaps a date) the face ends on what the select actually holds.
            onPreview: value => {
                const chosen = /** @type {any} */ (Array.from(select.options).find(o => /** @type {any} */ (o).value === value));
                if (chosen) face.textContent = String(chosen.textContent ?? '').trim();
            },
            onPick: value => {
                if (select.value === value) return;   // re-picking the open one changes nothing
                select.value = value;
                select.dispatchEvent(new Event('input',  { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
            },
        });
    });

    return paint;
}

/**
 * Open the shared sheet over an arbitrary set of options and report the pick.
 *
 * Exported (v23.38) for the caller that has NO persistent `<select>` to enhance — the Links
 * grid's cell editor, where the control is a grid cell and the old dropdown was created,
 * focused and destroyed per edit. `enhanceSelect` is the case where a select exists and holds
 * the value; this is the case where the caller holds it. Both draw the same sheet, which is the
 * point: one popup implementation, so the app's dropdown cannot become two that resemble each
 * other. Same split as `date-picker.js`'s `initDatePickers` / `openDatePicker`.
 *
 * `onPick` fires once the sheet's close has LANDED — the fade finished and the popstate echo of
 * its `history.back()` arrived — for the reason every sheet action in this app waits: a dialog
 * opened from the callback before that echo would race the traversal and pop itself (the Links
 * grid editor opens `promptDialog` from exactly this callback). Until v23.61 that wait was a fixed
 * 320 ms timer, 120 ms past a 200 ms fade and no guarantee of the echo at all; it is now
 * `createLightbox`'s own `close()` promise, so under reduced motion it is a frame rather than a
 * third of a second. `onPreview` fires SYNCHRONOUSLY on the tap for the caller that wants to
 * repaint its control while the sheet fades. Neither is called when the sheet is dismissed — a
 * cancel is not a pick.
 * @param {{ title: string, groups: SheetGroup[], current?: string, subtitle?: string,
 *           onPick: (value: string) => void, onPreview?: (value: string) => void,
 *           createLightbox?: (opts: any) => { open: () => void, close: () => (Promise<void>|void) } }} opts
 */
export function openOptionSheet(opts) {
    if (opts.createLightbox) _createLightbox = opts.createLightbox;
    const sheet = ensureSheet();
    if (!sheet) return;
    const title = opts.title || 'Choose an option';
    sheet.overlay.setAttribute('aria-label', title);
    sheet.title.textContent = title;
    const groups = opts.groups || [];
    const count = groups.reduce((n, g) => n + g.options.length, 0);
    sheet.sub.textContent = opts.subtitle
        || (count === 1 ? '1 option' : `${count} options`);
    sheet.list.textContent = '';
    for (const g of groups) {
        const wrap = document.createElement('div');
        wrap.className = 'picker-group';
        if (g.label) {
            wrap.setAttribute('role', 'group');
            wrap.setAttribute('aria-label', g.label);
            const h = document.createElement('div');
            h.className = 'picker-group-label';
            h.setAttribute('aria-hidden', 'true');
            h.textContent = g.label;
            wrap.appendChild(h);
        }
        for (const o of g.options) wrap.appendChild(optionRow(o, o.value === opts.current));
        sheet.list.appendChild(wrap);
    }
    if (!count) {
        const empty = document.createElement('p');
        empty.className = 'picker-empty';
        empty.textContent = 'Nothing to choose from yet.';
        sheet.list.appendChild(empty);
    }
    sheet.list.onclick = (/** @type {any} */ ev) => {
        const row = ev.target?.closest?.('.picker-opt[data-value]');
        if (!row || row.disabled) return;
        const value = row.dataset.value;
        opts.onPreview?.(value);
        // A factory whose close() returns nothing (the unit tests' fakes) resolves at once; the
        // real one resolves when the close has landed — see the JSDoc above.
        Promise.resolve(sheet.lb.close()).then(() => opts.onPick(value));
    };
    sheet.lb.open();
}

/**
 * Enhance several selects by id. Missing ids are skipped — a page that does not carry
 * one of them is not an error, which is what lets one call site serve several pages.
 * @param {Array<{ id: string, title: string, placeholder?: string }>} specs
 * @param {{ createLightbox?: (opts: any) => { open: () => void, close: () => (Promise<void>|void) } }} [opts]
 */
export function initSelectSheets(specs, opts = {}) {
    if (opts.createLightbox) _createLightbox = opts.createLightbox;
    /** @type {Record<string, () => void>} */
    const refreshers = {};
    for (const spec of specs) {
        const el = /** @type {HTMLSelectElement|null} */ (document.getElementById(spec.id));
        refreshers[spec.id] = enhanceSelect(el, { title: spec.title, placeholder: spec.placeholder });
    }
    return refreshers;
}
