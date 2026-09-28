# Polished Clean: the fewest cells changed to meet every rule, with a weekday closer at 16:25 accepted as well as 15:45.
# One solve per placement of the four cover weeks (every 6 lines: offsets 0..5), and one keeping them where drawn.
import sys, json, time
sys.path.insert(0,'.')
from common import *
from model import build, extract
from evaluator import judge
from ortools.sat.python import cp_model
P=load(PROP+'Polished-Clean-PC-24-EXT.json')
UP=sorted(set(U)|times_of(P), key=lambda s:(st(s),en(s)))
CL=('15:45-23:55','16:25-23:55')
T=float(sys.argv[1]); cases=sys.argv[2].split(',')
for c in cases:
    S={1,7,12,17} if c=='asdrawn' else {int(c)+1,int(c)+7,int(c)+13,int(c)+19}
    fmax=int(sys.argv[3]) if len(sys.argv)>3 and sys.argv[3]!='-' else None
    m,x,z,changes,factors,WORK=build(base=P, spares=S, uni=UP, closers=CL, fmax=fmax)
    m.Minimize(changes)
    s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
    t0=time.time(); r=s.Solve(m)
    row={'case':c,'spares':sorted(S),'status':s.StatusName(r),'bound':s.BestObjectiveBound(),'time':round(time.time()-t0)}
    if r in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        p=extract(s,x,WORK,base=P); row.update(changes=int(s.Value(changes)),factors=int(s.Value(factors)))
        json.dump(p,open(f'pc-{c}{"-f"+sys.argv[3] if len(sys.argv)>3 else ""}.json','w'),indent=1)
    print(json.dumps(row),flush=True)
