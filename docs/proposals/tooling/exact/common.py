# Shared definitions for the exact Fifteen Turns solver (see model.py). Paths are relative to this folder.
import json, itertools, os
DAYS=['sun','mon','tue','wed','thu','fri','sat']
PROP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..')+os.sep
def mins(t): h,m=t.split(':'); return int(h)*60+int(m)
def st(s): return mins(s.split('-')[0])
def en(s):
    a,b=s.split('-'); a,b=mins(a),mins(b); return b if b>a else b+1440
def dur(s): return en(s)-st(s)
def load(f):
    j=json.load(open(f)); return j.get('patterns',j)
FT=load(PROP+'Fifteen-Turns-FT-24-EXT.json')
GM=load(PROP+'Gates-Mended-FT-24-R21.json')
TODAY=['06:20-13:35','06:20-13:45','06:20-14:00','06:20-14:20','06:20-14:50','07:15-15:45','08:00-16:30','08:30-16:30','11:00-19:30','12:00-20:00','13:00-21:00','13:30-21:00','13:30-22:00','14:00-22:30','14:30-22:00','14:30-23:25','14:45-23:55','15:15-23:55']
def times_of(p): return {p[k][d] for k in p for d in DAYS if p[k][d] not in ('RD','SPARE')}
U=sorted(times_of(FT)|times_of(GM)|set(TODAY)|{'15:45-23:55','07:15-15:30','13:30-22:30','06:20-14:20','14:00-22:30','06:20-14:50','14:30-22:00'}, key=lambda s:(st(s),en(s)))
OPEN={'wk':380,'sat':380,'sun':435}; CLOSE={'wk':1435,'sat':1435,'sun':1405}
def cls(d): return 'sun' if d=='sun' else 'sat' if d=='sat' else 'wk'
def domain(d):
    c=cls(d); return [s for s in U if st(s)>=OPEN[c] and en(s)<=CLOSE[c] and (c!='sun' or 480<=dur(s)<=540)]
SPARE_LINES={6,12,18,24}
