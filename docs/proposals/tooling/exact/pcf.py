# Polished Clean: the fewest fatigue factors at a given number of changes (and cover-week placement)
import sys, json, time
sys.path.insert(0,'.')
from common import *
from model import build, extract
from evaluator import judge
from ortools.sat.python import cp_model
P=load(PROP+'Polished-Clean-PC-24-EXT.json'); UP=sorted(set(U)|times_of(P), key=lambda s:(st(s),en(s))); CL=('15:45-23:55','16:25-23:55')
C=int(sys.argv[1]); S={int(v) for v in sys.argv[2].split(',')}; T=float(sys.argv[3]); hint=load(sys.argv[4]); out=sys.argv[5]
m,x,z,changes,factors,WORK=build(base=P, spares=S, uni=UP, closers=CL, cmax=C)
m.Minimize(factors)
for (k,d,v),var in x.items(): m.AddHint(var, 1 if hint[k][d]==v else 0)
s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
r=s.Solve(m); p=extract(s,x,WORK,base=P)
print(json.dumps({'status':s.StatusName(r),'factors':int(s.ObjectiveValue()),'bound':s.BestObjectiveBound(),'changes':int(s.Value(changes)),'which':[f for f,v in z.items() if s.Value(v)]}),flush=True)
json.dump(p,open(out,'w'),indent=1)
