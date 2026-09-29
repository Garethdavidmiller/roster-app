# Among grids with at most C changes and at most F factors, the one whose remaining factors are the mildest,
# decided lexicographically, each stage proven before the next is fixed:
#   1 · FF19 — fewest start-time jumps over 2h inside a working block
#   2 · FF8b — fewest blocks of early starts without two rest days after
#   3 · MRSF — the lowest most-hours-in-any-7-days
#   4 · the longest worked run (design target 6)
#   5 · the most weeks with one clock time Mon–Fri (keeps a line's week coherent)
#   usage: python3 tiebreak.py C F out.json [seconds-per-stage]
import os, sys, json, time
sys.path.insert(0,'.')
from common import *
from model import build, extract
from evaluator import judge
from ortools.sat.python import cp_model

C,F,OUT=int(sys.argv[1]),int(sys.argv[2]),sys.argv[3]; T=float(sys.argv[4]) if len(sys.argv)>4 else 600
# BASE=<grid.json, e.g. ../polished-clean.json> SPARES=1,7,13,19 CLOSERS=15:45-23:55,16:25-23:55 — for a base other than Fifteen Turns (Polished Clean)
BASE=load(os.environ['BASE']) if os.environ.get('BASE') else FT
SPS={int(v) for v in os.environ['SPARES'].split(',')} if os.environ.get('SPARES') else SPARE_LINES
CLS_=tuple(os.environ['CLOSERS'].split(',')) if os.environ.get('CLOSERS') else ('15:45-23:55',)
_uni=set(U)|times_of(BASE)
# WIDE=1 — every shift time used by any sheet in the folder joins the pool (Running Repair, 29 Sep 2026: the fits must
# compete with the best sheets, whose Saturday times are not in the Fifteen Turns pool)
if os.environ.get('WIDE'):
    import glob
    for f in glob.glob(PROP+'*.json'): _uni|=times_of(load(f))
UNI=sorted(_uni, key=lambda s:(st(s),en(s)))
# SATMIN=12 TMAX=18 — the Saturday headcount and the most distinct shift times (Weekday Lates' repair, 29 Sep 2026)
SATMIN=int(os.environ.get('SATMIN','14')); TMAX=int(os.environ.get('TMAX','18'))
def domain(d):
    c=cls(d); return [s for s in UNI if st(s)>=OPEN[c] and en(s)<=CLOSE[c] and (c!='sun' or 480<=dur(s)<=540)]

def model():
    m,x,z,changes,factors,WORK=build(base=BASE,spares=SPS,uni=UNI,closers=CLS_,fmax=F,cmax=C,sat_min=SATMIN,tmax=TMAX)
    # MIX=<file.json> — each day's duty mix fixed ({"mix": {day: {time|RD: count}}}): the rota for a chosen mix
    if os.environ.get('MIX'):
        MX=json.load(open(os.environ['MIX'])); MX=MX.get('mix',MX)
        for d in DAYS:
            for v in domain(d)+['RD']: m.Add(sum(x[k,d,v] for k in WORK if (k,d,v) in x)==MX[d].get(v,0))
    LINES=[str(k) for k in range(1,25)]; POS=[(k,d) for k in LINES for d in DAYS]; N=len(POS)
    spare=lambda i: int(POS[i][0]) in SPS
    V=lambda d: domain(d)
    E=lambda i: 0 if spare(i) else sum(x[POS[i][0],POS[i][1],v] for v in V(POS[i][1]) if 300<=st(v)<420)
    R=lambda i: x[POS[i][0],POS[i][1],'RD']
    D=lambda i: 0 if spare(i) else sum(dur(v)*x[POS[i][0],POS[i][1],v] for v in V(POS[i][1]))
    W=lambda i: 1 if spare(i) else 1-R(i)
    jumps=[]
    for i in range(N):
        j=(i+1)%N
        if spare(i) or spare(j): continue
        (k1,d1),(k2,d2)=POS[i],POS[j]; b=m.NewBoolVar(f'j{i}'); jumps.append(b)
        for v in V(d1):
            bad=[w for w in V(d2) if abs(st(w)-st(v))>120]
            if bad: m.Add(b>=x[k1,d1,v]+sum(x[k2,d2,w] for w in bad)-1)
    ff8=[]
    for i in range(N):
        a,b_,c1,c2=(i-1)%N,i,(i+1)%N,(i+2)%N
        if spare(a) or spare(b_): continue
        q=m.NewBoolVar(f'qq{i}'); y=m.NewBoolVar(f'y{i}'); ff8.append(y)
        if spare(c1) or spare(c2): m.Add(q==0)
        else: m.Add(q<=R(c1)); m.Add(q<=R(c2))
        m.Add(E(a)+E(b_)-E(c1)-q-1<=y)
    h=m.NewIntVar(0,5000,'h7')
    for i in range(N): m.Add(sum(D((i+t)%N) for t in range(7))<=h)
    run=m.NewIntVar(0,14,'run')
    # worst-case run: pure windows and the cover-week extensions (same shapes as the hard rule)
    before=[i for i in range(N) if not spare(i) and spare((i+1)%N)]; after=[i for i in range(N) if not spare(i) and spare((i-1)%N)]
    # exact: run >= L whenever a pure window of L is all worked; run >= 4+P / 4+F around cover weeks
    for L in range(5,14):
        for i in range(N):
            idx=[(i+t)%N for t in range(L)]
            if any(spare(q) for q in idx): continue
            m.Add(run>=L - L*(L-sum(W(q) for q in idx)))
        for b in before:
            if L>4: m.Add(run>=L - L*((L-4)-sum(W((b-t)%N) for t in range(L-4))))
        for a in after:
            if L>4: m.Add(run>=L - L*((L-4)-sum(W((a+t)%N) for t in range(L-4))))
    # one-turn weeks (feel.oneTurn): Mon–Fri worked days on one clock time, and every worked day in one family
    fam=lambda v: 'early' if st(v)<11*60 else 'late'   # report-data family(): early before 11:00
    one=[]
    WORKL=[k for k in LINES if int(k) not in SPS]
    for k in WORKL:
        o=m.NewBoolVar(f'one{k}'); one.append(o)
        # o -> exists a single value v used on every worked Mon–Fri day ... encoded as: for each pair of weekdays both worked, same value
        wd=['mon','tue','wed','thu','fri']
        for i1 in range(5):
            for i2 in range(i1+1,5):
                for v in domain(wd[i1]):
                    others=[w for w in domain(wd[i2]) if w!=v]
                    m.Add(x[k,wd[i1],v]+sum(x[k,wd[i2],w] for w in others)<=2-o)
        for d1 in DAYS:
            for d2 in DAYS:
                if d1>=d2: continue
                for v in domain(d1):
                    otherfam=[w for w in domain(d2) if fam(w)!=fam(v)]
                    if otherfam: m.Add(x[k,d1,v]+sum(x[k,d2,w] for w in otherfam)<=2-o)
    # full weekends off (runDesignChecks): Sat of line k and Sun of line k+1 both rest; a cover day is worked
    wkends=[]
    for i,k in enumerate(LINES):
        nk=LINES[(i+1)%24]
        if int(k) in SPS or int(nk) in SPS: continue
        w=m.NewBoolVar(f'wk{k}'); m.Add(w<=x[k,'sat','RD']); m.Add(w<=x[nk,'sun','RD']); wkends.append(w)
    # the SIZE of the changes: minutes the start and finish move, a rest day <-> duty counted as a whole duty (8h each end)
    def size(a,b):
        if a==b: return 0
        if a in ('RD','SPARE') or b=='RD': return 960
        return abs(st(a)-st(b))+abs(en(a)-en(b))
    sz=sum(size(BASE[k][d],v)*var for (k,d,v),var in x.items() if size(BASE[k][d],v))
    # the number of distinct shift times worked (feel.distinctTimes): a time counts once it is used on any day
    tvars=[]
    for v in UNI:
        uses=[var for (k,d,w),var in x.items() if w==v]
        if not uses: continue
        tv=m.NewBoolVar('tt'+v); tvars.append(tv)
        for var in uses: m.AddImplication(var, tv)
    return m,x,z,changes,factors,WORK,sum(jumps),sum(ff8),h,run,sum(one),sum(wkends),sz,sum(tvars)

stages=(sys.argv[6].split(',') if len(sys.argv)>6 else ['jumps','ff8','h','run','one'])
HINT=json.load(open(sys.argv[5])) if len(sys.argv)>5 else BASE
# FIXED=wk=-2,size=16770 — resume after a lost run: stages already proven/settled, fixed at these values
fixed={kv.split('=')[0]:int(kv.split('=')[1]) for kv in os.environ['FIXED'].split(',')} if os.environ.get('FIXED') else {}
for si,st_ in enumerate(stages):
    m,x,z,changes,factors,WORK,J,F8,H,RUN,ONE,WK,SZ,TT=model()
    exprs={'jumps':J,'ff8':F8,'h':H,'run':RUN,'one':-ONE,'wk':-WK,'size':SZ,'factors':factors,'times':TT,'changes':changes}
    for k,v in fixed.items():
        m.Add(exprs[k]<=v)
    m.Minimize(exprs[st_])
    for (k,d,v),var in x.items(): m.AddHint(var, 1 if HINT.get(k,{}).get(d)==v else 0)
    s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4
    t0=time.time(); r=s.Solve(m)
    assert r in (cp_model.OPTIMAL,cp_model.FEASIBLE), 'no solution at stage '+st_
    val=int(round(s.ObjectiveValue())); fixed[st_]=val
    print(st_, s.StatusName(r), 'value', val, 'bound', s.BestObjectiveBound(), 'time', round(time.time()-t0,1), flush=True)
    p=extract(s,x,WORK,base=BASE); json.dump(p,open(OUT,'w'),indent=1); HINT=p
Jd=judge(p); print('final', 'changes', s.Value(changes), 'factors', [f for f,v in Jd['factors'].items() if v], 'run', Jd['run'], 'rules', all(Jd['rules'].values()))
