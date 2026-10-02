# Weekday Lates, repaired (owner, 29 Sep 2026): the fewest cells changed so that WEEKDAY LATES (WL-24-EXT) meets every
# December 2026 rule and the three hard limits, with two allowances — weekday closers may start at 16:25 as well as
# 15:45, and Saturday needs 12 on duty, not 14 — and no more distinct shift times than Weekday Lates' own 18.
# One solve per placement of the four cover weeks (every 6 lines: offsets 0..5) and one keeping them where drawn.
#   python3 wlr.py <seconds> <cases, e.g. 0,1,2,3,4,5,asdrawn> <fmax or -> [tmax] [wide]
import sys, json, time, glob
sys.path.insert(0,'.')
from common import *
from model import build, extract
from ortools.sat.python import cp_model
P=load(PROP+'proposals/Weekday-Lates-WL-24-EXT.json')
UW=set(U)|times_of(P)
if len(sys.argv)>5 and sys.argv[5]=='wide':   # every shift time used by any sheet in the folder
    for f in glob.glob(PROP+'proposals/*.json'): UW|=times_of(load(f))
UW=sorted(UW, key=lambda s:(st(s),en(s)))
CL=('15:45-23:55','16:25-23:55')
T=float(sys.argv[1]); cases=sys.argv[2].split(',')
fmax=int(sys.argv[3]) if sys.argv[3]!='-' else None
tmax=int(sys.argv[4]) if len(sys.argv)>4 else 18
for c in cases:
    S={1,7,12,17} if c=='asdrawn' else {int(c)+1,int(c)+7,int(c)+13,int(c)+19}
    m,x,z,changes,factors,WORK=build(base=P, spares=S, uni=UW, closers=CL, fmax=fmax, sat_min=12, tmax=tmax)
    m.Minimize(changes)
    s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
    t0=time.time(); r=s.Solve(m)
    row={'case':c,'spares':sorted(S),'fmax':fmax,'tmax':tmax,'uni':len(UW),'status':s.StatusName(r),'bound':s.BestObjectiveBound(),'time':round(time.time()-t0)}
    if r in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        p=extract(s,x,WORK,base=P); row.update(changes=int(s.Value(changes)),factors=int(s.Value(factors)),which=[f for f,v in z.items() if s.Value(v)])
        json.dump(p,open(f'wlr-{c}-f{sys.argv[3]}-t{tmax}{"-wide" if len(sys.argv)>5 else ""}.json','w'),indent=1)
    print(json.dumps(row),flush=True)
