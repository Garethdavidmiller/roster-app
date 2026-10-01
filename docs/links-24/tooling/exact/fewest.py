import os, sys, json, time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
from model import build, extract
from evaluator import judge
from ortools.sat.python import cp_model
F=int(sys.argv[1]); T=float(sys.argv[2]); hint=json.load(open(sys.argv[3])); out=sys.argv[4]
m,x,z,changes,factors,WORK=build(fmax=F)
m.Minimize(changes)
for (k,d,v),var in x.items(): m.AddHint(var, 1 if hint[k][d]==v else 0)
s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
t0=time.time(); r=s.Solve(m)
p=extract(s,x,WORK); J=judge(p)
print(json.dumps({'fmax':F,'status':s.StatusName(r),'changes':int(s.Value(changes)),'bound':s.BestObjectiveBound(),'time':round(time.time()-t0),'factors':[f for f,v in J['factors'].items() if v],'rules':all(J['rules'].values()),'turn':J['turn']}))
json.dump(p,open(out,'w'),indent=1)
