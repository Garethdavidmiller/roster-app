# The cover-week waiver (owner, 29 Sep 2026): four cover weeks anywhere, never next to each other. Moving one costs
# 14 changes (the line it leaves and the line it takes), two cost 28 — so against a best of B with the weeks as drawn,
# only layouts with ONE week moved can compete, and each must be shown to need B or more.
#   python3 wlr1.py <fmax> <B> <seconds each>
import sys, json, time
sys.path.insert(0,'.')
from common import *
from model import build, extract
from ortools.sat.python import cp_model
P=load(PROP+'proposals/Weekday-Lates-WL-24-EXT.json'); UW=sorted(set(U)|times_of(P), key=lambda s:(st(s),en(s)))
F=int(sys.argv[1]); B=int(sys.argv[2]); T=float(sys.argv[3]); D={1,7,12,17}
adj=lambda a,b: (a-b)%24 in (1,23)
for out in sorted(D):
    for new in range(1,25):
        S=(D-{out})|{new}
        if new in D or any(adj(a,b) for a in S for b in S if a<b): continue
        m,x,z,changes,factors,WORK=build(base=P, spares=S, uni=UW, closers=('15:45-23:55','16:25-23:55'), fmax=F, sat_min=12, tmax=18, cmax=B-1)
        m.Minimize(changes)
        s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
        t0=time.time(); r=s.Solve(m)
        print(json.dumps({'spares':sorted(S),'status':s.StatusName(r),'changes':int(s.Value(changes)) if r in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None,'time':round(time.time()-t0,1)}),flush=True)
