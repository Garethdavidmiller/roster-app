# THE MARKS BESIDE THE COLOURS (whole-pack review, 5 Nov 2026). The decks said "better than today" and "worse than today" by
# colour alone — green and amber — and the two are within a few per cent of each other's lightness: they print as one grey,
# and read alike to the commonest colour blindness. The proposal sheets have always put a ✓ or a ▲ beside the colour (their
# page 2 key says so); this gives the decks the same. A green figure gains a ✓ and an amber one a ▲.
#
# A FIGURE is a coloured run that begins with a digit. The headings coloured green or amber ("You work these today (8)",
# "Likely to welcome") begin with a letter and are left alone, as is every run in navy, the colour for "level with today".
#
# IT RUNS LAST, after common-ground-decks.py, which re-colours some of Even Step's cells for Common Ground (an earlier mark
# would have had to be stripped and re-judged there). deck-check.mjs refuses a deck holding a coloured figure with no mark,
# or a mark that disagrees with its colour, so a rebuild that skips this step fails rather than shipping unmarked. A figure
# already marked is left alone, so running it twice changes nothing.
#   python3 docs/links-26/tooling/deck-marks.py
import os, re, shutil, tempfile, zipfile

TOOL = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(TOOL, '..', 'presentations')
# second-nature-decks.py's own colours, read rather than typed again
GREEN, AMBER = re.search(r"^NAVY, GREEN, AMBER = '[0-9A-F]{6}', '([0-9A-F]{6})', '([0-9A-F]{6})'", open(os.path.join(TOOL, 'second-nature-decks.py'), encoding='utf-8').read(), re.M).groups()
MARK = {GREEN: '✓', AMBER: '▲'}
COLOUR = re.compile(r'<a:rPr\b[^>]*>(?:(?!</a:rPr>).)*?<a:srgbClr val="([0-9A-Fa-f]{6})"', re.S)   # the run's own colour, inside its rPr

def mark(xml):
    """Every green or amber figure in one slide, marked; returns the new XML and how many were marked."""
    n = 0
    def one(m):
        nonlocal n
        run = m.group(0); t = re.search(r'<a:t>([^<]*)</a:t>', run); c = COLOUR.search(run)
        g = c and MARK.get(c.group(1).upper())
        if not (t and g and re.match(r'\d', t.group(1))): return run
        n += 1
        return run.replace(f'<a:t>{t.group(1)}</a:t>', f'<a:t>{g} {t.group(1)}</a:t>', 1)   # a no-break space: the mark never ends a line
    return re.sub(r'<a:r>.*?</a:r>', one, xml, flags=re.S), n

def deck(path):
    d = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(path) as z: names = z.namelist(); z.extractall(d)
        total = {}
        for name in names:
            m = re.fullmatch(r'ppt/slides/slide(\d+)\.xml', name)
            if not m: continue
            p = os.path.join(d, name); x = open(p, encoding='utf-8').read()
            y, n = mark(x)
            if n: open(p, 'w', encoding='utf-8').write(y); total[int(m.group(1))] = n
        tmp = path + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
            for name in names: z.write(os.path.join(d, name), name)   # the deck's own part order, [Content_Types].xml first
        os.replace(tmp, path)
        return total
    finally:
        shutil.rmtree(d, ignore_errors=True)

if __name__ == '__main__':
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('.pptx'): continue
        got = deck(os.path.join(OUT, f))
        print(f'{f}: ' + (', '.join(f'slide {k} {v}' for k, v in sorted(got.items())) if got else 'nothing new to mark'))
