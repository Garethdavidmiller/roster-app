# The frontier: for every fatigue-factor budget, the fewest cell changes (proven, or bounded) — and at the
# minimum change count, the fewest factors. Writes one grid per point: front-f<F>.json
import os, sys, json, time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
from model import build, extract
from evaluator import judge
from ortools.sat.python import cp_model

T=float(sys.argv[1]) if len(sys.argv)>1 else 900
FS=[int(a) for a in sys.argv[2].split(',')] if len(sys.argv)>2 else list(range(0,9))
res=[]
for F in FS:
    m,x,z,changes,factors,WORK=build(fmax=F)
    m.Minimize(changes)
    s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
    t0=time.time(); r=s.Solve(m)
    row={'fmax':F,'status':s.StatusName(r),'time':round(time.time()-t0,1),'bound':s.BestObjectiveBound()}
    if r in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        p=extract(s,x,WORK); J=judge(p)
        row.update(changes=int(s.Value(changes)),model_factors=[f for f,v in z.items() if s.Value(v)],
                   true_factors=[f for f,v in J['factors'].items() if v],rules_ok=all(v for v in J['rules'].values()),
                   turn=J['turn'],run=J['run'],monsat=J['monsat'])
        json.dump(p,open(f'front-f{F}.json','w'),indent=1)
    print(json.dumps(row),flush=True); res.append(row)
json.dump(res,open('frontier.json','w'),indent=1)
