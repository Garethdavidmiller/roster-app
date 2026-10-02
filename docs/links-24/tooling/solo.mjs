// THE SHEET ON ITS OWN (owner, 29 Sep 2026): each proposal is compared with today's link and nothing else.
// Managers and colleagues are shown one proposal at a time and are unlikely to see the other drafts, so a sheet that
// ranks a design against 27 others it never names in full reads as a contest the reader was not given. This pass
// takes the finished ten-page sheet and removes every comparison with the other proposals — page 9 ("Beside the
// other proposals") in full, the gold and grey best/worst ticks on page 2's scales, the "of the others" notes on
// page 1's tiles, and the family row that names a sibling design — renumbering the last page to 9 of 9.
// Everything else is the sheet exactly as rendered: the owner preferred this layout, so nothing here restyles it.
// The one-page links-24-summary.pdf is the owner's own comparison of all the drafts and is not touched.

/** Removes every comparison with other proposals from a rendered sheet. Throws if an expected anchor is missing,
 *  so a change to render.mjs cannot silently leave a comparison behind. */
export function soloEdition(html) {
  const parts = html.split(/(?=<section class="page)/);
  const kept = parts.filter(s => !/Page 9 of 10 — Beside the other proposals/.test(s));
  if (kept.length !== parts.length - 1) throw new Error('soloEdition: page 9 (Beside the other proposals) not found exactly once');
  let s = kept.join('');
  const must = (re, to, what) => { if (!re.test(s)) throw new Error(`soloEdition: ${what} not found`); re.lastIndex = 0; s = s.replace(re, to); };
  // page numbers — the import page moves up to 9
  must(/Page 10 of 10/g, 'Page 9 of 9', 'the page 10 footer');
  must(/Page (\d) of 10/g, 'Page $1 of 9', 'the page footers');
  // the contents strip on page 3 and the sentence that sends the reader to page 9
  must(/<span><b>9<\/b> Beside the other proposals<\/span>/g, '', 'the page-9 contents entry');
  must(/<b>10<\/b> The rota, ready to paste/g, '<b>9</b> The rota, ready to paste', 'the page-10 contents entry');
  s = s.replace(/,? and page 9 sets it beside the other \d+ proposals on the same figures/g, '');
  // page 1: the family row names a sibling design; the tiles' "of the others" notes
  must(/<div class="ident-row ident-minor"><span class="ident-k">Family<\/span><span class="ident-v">[^<]*<\/span><\/div>/g, '', 'the family row');
  s = s.replace(/ · (?:most|fewest|best) of the others[^<·]*/g, '');
  s = s.replace(/, with today(’|')s link and the (?:other proposals|rest of the folder) marked on a scale/g, ', with today$1s link marked on a scale');
  // page 2: the gold and grey ticks, their key, and the folder bests in the notes beneath
  must(/<span><i class="m m-(?:best|worst)"><\/i>[^<]*(?:<b>[^<]*<\/b>)?<\/span>/g, '', 'the best/worst key');
  // the key goes first: its own swatches are the same <i> as the ticks on the bar
  must(/<i class="m m-(?:best|worst)"[^>]*><\/i>/g, '', 'the best/worst ticks');
  s = s.replace(/, the best and worst of the other \d+ proposals as gold and grey ticks/g, '');
  s = s.replace(/, folder best [^)]*\)/g, ')').replace(/, best [\d.—]+\)/g, ')');
  const left = s.match(/(?:of the others|other \d+ proposals|in the folder|folder best|Beside the other)/i);
  if (left) throw new Error(`soloEdition: a comparison is left behind — "${left[0]}"`);
  return s;
}
