# A FIT stage for any exact design: the best Saturday or Sunday floor fit reachable while every figure already settled
# is held. A day's duty counts are constrained to a TABLE of every line-up of that day that passes the day's December
# rows, each with its floor fit (x10) as the sheets measure it — built outside the solver by reach.mjs / enum.mjs and
# checked against the sheets' own code on random grids. Other env as tiebreak.py (BASE, SPARES, CLOSERS, SATMIN, TMAX).
#   HOLD=factors=4,times=14,run=9,wk=-5,h=3575,jumps=4,ff8=5,one=-8   each held at <= (wk/one are negated, as in tiebreak)
#   REST=875        shortest rest between two duties held at >= this many minutes
#   FREEZE=mon,tue  these days keep the hint's exact duty counts (so their fits cannot move)
#   TAB_sun=f.json TAB_sat=g.json   the tables (rows: counts in domain order, fit*10[, cells changed])
#   MIN=sun         the day whose fit is minimised; FIT_sat=567 holds the other table's fit at <= a value
#   python3 fitstage.py C F hint.json out.json seconds
import os, sys, json, time
sys.path.insert(0,'.')
from common import *
from ortools.sat.python import cp_model
C,F,HINTF,OUT,T=int(sys.argv[1]),int(sys.argv[2]),sys.argv[3],sys.argv[4],float(sys.argv[5])
sys.argv=[sys.argv[0],str(C),str(F),'/dev/null',str(T)]
import importlib.util
if not os.path.exists('tiebreak_model.py') or os.path.getmtime('tiebreak_model.py')<os.path.getmtime('tiebreak.py'):
    open('tiebreak_model.py','w').write(open('tiebreak.py').read().split("stages=(sys.argv[6]")[0])
spec=importlib.util.spec_from_file_location('tb_model','tiebreak_model.py'); tb=importlib.util.module_from_spec(spec); spec.loader.exec_module(tb)
from model import extract
HINT=load(HINTF)
m,x,z,changes,factors,WORK,J,F8,H,RUN,ONE,WK,SZ,TT=tb.model()
ex={'jumps':J,'ff8':F8,'h':H,'run':RUN,'one':-ONE,'wk':-WK,'size':SZ,'factors':factors,'times':TT,'changes':changes}
m.Add(changes<=C); m.Add(factors<=F)
for kv in filter(None,os.environ.get('HOLD','').split(',')):
    k,v=kv.split('='); m.Add(ex[k]<=int(v))
LINES=[str(k) for k in range(1,25)]; POS=[(k,d) for k in LINES for d in DAYS]; N=len(POS)
SP=tb.SPS
if os.environ.get('REST'):
    R=int(os.environ['REST'])
    for i in range(N):
        j=(i+1)%N; (k1,d1),(k2,d2)=POS[i],POS[j]
        if int(k1) in SP or int(k2) in SP: continue
        for v in tb.domain(d1):
            bad=[w for w in tb.domain(d2) if (1440-en(v))+st(w)<R]
            if bad: m.Add(x[k1,d1,v]+sum(x[k2,d2,w] for w in bad)<=1)
for d in filter(None,os.environ.get('FREEZE','').split(',')):
    vals={}
    for k in WORK: vals[HINT[k][d]]=vals.get(HINT[k][d],0)+1
    for v in tb.domain(d)+['RD']: m.Add(sum(x[k,d,v] for k in WORK)==vals.get(v,0))
fits={}
for d in ('sat','sun'):
    f=os.environ.get('TAB_'+d)
    if not f: continue
    dom=tb.domain(d); rows=json.load(open(f)); n=len(dom)
    cv=[m.NewIntVar(0,24,f'c{d}{v}') for v in dom]
    for v,c in zip(dom,cv): m.Add(c==sum(x[k,d,v] for k in WORK))
    fv=m.NewIntVar(0,100000,'fit'+d); fits[d]=fv
    m.AddAllowedAssignments(cv+[fv],[tuple(r[:n+1]) for r in rows])
    if os.environ.get('FIT_'+d): m.Add(fv<=int(os.environ['FIT_'+d]))
    print('table',d,len(rows),'rows',flush=True)
MIN=os.environ.get('MIN','sun'); m.Minimize(fits[MIN])
for (k,d,v),var in x.items(): m.AddHint(var, 1 if HINT.get(k,{}).get(d)==v else 0)
s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
class CB(cp_model.CpSolverSolutionCallback):
    def __init__(s2): super().__init__(); s2.t0=time.time()
    def on_solution_callback(s2): print('  found',MIN,s2.Value(fits[MIN])/10,'at',round(time.time()-s2.t0),'s bound',s2.BestObjectiveBound()/10,flush=True)
r=s.Solve(m,CB())
print('status',s.StatusName(r),MIN,s.ObjectiveValue()/10 if r in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None,'bound',s.BestObjectiveBound()/10,flush=True)
if r in (cp_model.OPTIMAL,cp_model.FEASIBLE):
    p=extract(s,x,WORK,base=tb.BASE); json.dump(p,open(OUT,'w'),indent=1)
    print({k:s.Value(v) for k,v in ex.items()}, {d:s.Value(v)/10 for d,v in fits.items()})
    print('sun',[(k,p[k]['sun']) for k in LINES if p[k]['sun'] not in ('RD','SPARE')])
    print('sat',[(k,p[k]['sat']) for k in LINES if p[k]['sat'] not in ('RD','SPARE')])
