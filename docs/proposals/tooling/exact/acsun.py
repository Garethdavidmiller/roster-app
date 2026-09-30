# All Clear's Sunday: the best Sunday floor fit reachable while every other All Clear figure stays at least as good.
# The Sunday column's count vector is constrained to a TABLE of every Sunday line-up that passes the Sunday rules,
# each tuple carrying its fit (x10, the sheets' own measure, sunfast.mjs); the solver minimises that fit.
# usage: TIER=A|B python3 acsun.py cand.json out.json seconds
import os, sys, json, time
sys.path.insert(0,'.')
from common import *
from ortools.sat.python import cp_model
sys.argv=[sys.argv[0],'41','0','/dev/null','600']+sys.argv[1:]
import importlib.util
spec=importlib.util.spec_from_file_location('tb_model', 'tiebreak_model.py'); tb=importlib.util.module_from_spec(spec); spec.loader.exec_module(tb)
CAND,OUT,T=sys.argv[5],sys.argv[6],float(sys.argv[7])
TIER=os.environ.get('TIER','A')
AC=load(PROP+'All-Clear-AC-24-M41.json')
DOMS=['07:15-15:30','07:15-15:45','08:00-16:30','08:30-16:30','10:00-18:30','11:00-19:30','12:00-20:00','13:00-21:00','13:00-21:30','13:30-22:00','13:30-22:30','14:00-22:00','14:00-22:30','14:30-23:25','15:00-23:00','15:25-23:25']
m,x,z,changes,factors,WORK,J,F8,H,RUN,ONE,WK,SZ,TT=tb.model()
LINES=[str(k) for k in range(1,25)]; POS=[(k,d) for k in LINES for d in DAYS]; N=len(POS)
SP={6,12,18,24}
# AC's own figures, measured the way the model measures them
def dd(k,d): v=AC[k][d]; return 0 if v in ('RD','SPARE') else dur(v)
hAC=max(sum(dd(*POS[(i+t)%N]) for t in range(7)) for i in range(N))
print('AC h',hAC)
m.Add(changes<=41); m.Add(factors==0); m.Add(TT<=16); m.Add(WK>=2); m.Add(RUN<=9); m.Add(ONE>=10); m.Add(H<=hAC)
# shortest rest at least All Clear's 14h05 (845 min)
for i in range(N):
    j=(i+1)%N; (k1,d1),(k2,d2)=POS[i],POS[j]
    if int(k1) in SP or int(k2) in SP: continue
    for v in tb.domain(d1):
        bad=[w for w in tb.domain(d2) if (1440-en(v))+st(w)<845]
        if bad: m.Add(x[k1,d1,v]+sum(x[k2,d2,w] for w in bad)<=1)
if TIER=='A':   # Monday-Saturday exactly All Clear's duties per day (so weekday and Saturday fit, office, closers, heads unchanged)
    for d in DAYS:
        if d=='sun': continue
        vals={}
        for k in WORK: vals[AC[k][d]]=vals.get(AC[k][d],0)+1
        for v in tb.domain(d)+['RD']: m.Add(sum(x[k,d,v] for k in WORK)==vals.get(v,0))
cnt=[sum(x[k,'sun',v] for k in WORK) for v in DOMS]
cv=[m.NewIntVar(0,20,'c'+v) for v in DOMS]
for a,b in zip(cv,cnt): m.Add(a==b)
# any Sunday value outside DOMS cannot be used (domain is DOMS already); RD is the rest
tab=json.load(open(CAND))
fitv=m.NewIntVar(0,10000,'fit')
m.AddAllowedAssignments(cv+[fitv], [tuple(r) for r in tab])
m.Minimize(fitv)
for (k,d,v),var in x.items(): m.AddHint(var, 1 if AC.get(k,{}).get(d)==v else 0)
s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
class CB(cp_model.CpSolverSolutionCallback):
    def __init__(s2): super().__init__(); s2.t0=time.time()
    def on_solution_callback(s2): print('  found fit',s2.Value(fitv)/10,'at',round(time.time()-s2.t0),'s bound',s2.BestObjectiveBound()/10,flush=True)
r=s.Solve(m,CB())
print('status',s.StatusName(r),'fit',s.ObjectiveValue()/10 if r in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None,'bound',s.BestObjectiveBound()/10,flush=True)
if r in (cp_model.OPTIMAL,cp_model.FEASIBLE):
    from model import extract
    p=extract(s,x,WORK,base=FT); json.dump(p,open(OUT,'w'),indent=1)
    print('changes',s.Value(changes),'times',s.Value(TT),'wk',s.Value(WK),'run',s.Value(RUN),'one',s.Value(ONE),'h',s.Value(H),'size',s.Value(SZ))
    print('sun',[(k,p[k]['sun']) for k in LINES if p[k]['sun'] not in ('RD','SPARE')])
