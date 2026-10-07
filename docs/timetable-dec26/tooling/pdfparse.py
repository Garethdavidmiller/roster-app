"""Parse Chiltern public timetable PDFs (pdftotext -bbox output) into trains.
Usage: pdfparse.py <pdf> <out.json>"""
import sys, re, json, subprocess, html, collections
pdf, outp = sys.argv[1], sys.argv[2]
xml = subprocess.run(['pdftotext', '-bbox', pdf, '-'], capture_output=True, text=True, check=True).stdout
pages = []
for pg in re.findall(r'<page[^>]*>(.*?)</page>', xml, re.S):
    words = [(float(a), float(b), float(c), float(d), html.unescape(t)) for a, b, c, d, t in
             re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', pg)]
    pages.append(words)
TIME = re.compile(r'^(\d{4})([a-z]?)$')
trains = []          # one per column
direction = None; title = None
for pi, W in enumerate(pages):
    top = sorted([w for w in W if w[1] < 60], key=lambda w: (round(w[1]), w[0]))
    toptext = ' '.join(w[4] for w in top)
    if re.match(r'^\d+:', toptext):
        title = re.sub(r'^\d+:\s*', '', toptext)
        direction = 'ret' if re.search(r'to\s+London\s*$', title) else 'out'
    heads = [w for w in W if w[4] in ('Monday', 'Saturday', 'Sunday') and w[0] < 60]
    ops = sorted([w for w in W if w[4] == 'Operator'], key=lambda w: w[1])
    for bi, op in enumerate(ops):
        y0 = op[1]; y1 = ops[bi + 1][1] if bi + 1 < len(ops) else 1e9
        h = max([hw for hw in heads if hw[1] < y0], key=lambda w: w[1], default=None)
        day = {'Monday': 'SX', 'Saturday': 'SO', 'Sunday': 'SU'}[h[4]] if h else None
        L = op[2]                                    # the label column's right edge, from the 'Operator' word
        cols = sorted([w for w in W if abs(w[1] - y0) < 2 and w[0] > L + 30], key=lambda w: w[0])
        centers = [((w[0] + w[2]) / 2, w[4]) for w in cols]
        rowwords = [w for w in W if y0 - 1 < w[1] < y1 - 1]
        notes_y = next((w[1] for w in rowwords if w[4] == 'Notes'), None)
        fac_y = next((w[1] for w in rowwords if w[4] == 'Facilities/Cycles'), None)
        crs = sorted([w for w in rowwords if re.fullmatch(r'[A-Z]{3}', w[4]) and L + 5 < w[0] < L + 35], key=lambda w: w[1])
        rows = []
        for c in crs:
            same = [w for w in rowwords if abs(w[1] - c[1]) < 2.5]
            ad = next((w[4] for w in same if w[4] in ('a', 'd') and c[2] < w[0] < c[2] + 8), 'd')
            name = ' '.join(w[4] for w in sorted(same, key=lambda w: w[0]) if w[2] < L + 1.5)
            rows.append(dict(y=c[1], crs=c[4], ad=ad, name=name))
        def col_of(w):
            cx = (w[0] + w[2]) / 2
            best = min(range(len(centers)), key=lambda i: abs(centers[i][0] - cx)) if centers else None
            return best if best is not None and abs(centers[best][0] - cx) < 10.5 else None
        C = [dict(op=centers[i][1], notes=[], fac=[], cells=[]) for i in range(len(centers))]
        cell_x = L + 36
        for w in rowwords:
            if w[0] < cell_x: continue
            ci = col_of(w)
            if ci is None: continue
            if notes_y and abs(w[1] - notes_y) < 2.5: C[ci]['notes'].append(w[4]); continue
            if fac_y and abs(w[1] - fac_y) < 2.5: C[ci]['fac'].append(w[4]); continue
            r = next((r for r in rows if abs(r['y'] - w[1]) < 2.5), None)
            if r is None: continue
            C[ci]['cells'].append(dict(crs=r['crs'], ad=r['ad'], name=r['name'], y=r['y'], text=w[4]))
        for ci, c in enumerate(C):
            c['cells'].sort(key=lambda x: (x['y'], x['text'] != 'f'))
            trains.append(dict(page=pi + 1, block=bi, col=ci, dir=direction, day=day, title=title, **c))
json.dump(trains, open(outp, 'w'), indent=1)
print(pdf.split('/')[-1], 'columns:', len(trains), collections.Counter((t['dir'], t['day']) for t in trains))
