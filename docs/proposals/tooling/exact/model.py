# Exact CP-SAT model: Fifteen Turns with the fewest cell changes that meet all 11 December rules and the three
# hard rules, with the nine fatigue factors that can occur on this link counted exactly as links-fatigue.js does.
import os, sys, json, time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
from ortools.sat.python import cp_model

ALLPARTS={'open','close','at22','heads','office','closer','floorhand','times','contract','rest','run'}
def build(base=FT, fmax=None, cmax=None, fix=None, forbid_factors=(), parts=ALLPARTS, domains=None):
    m=cp_model.CpModel()
    LINES=[str(k) for k in range(1,25)]
    WORK=[k for k in LINES if int(k) not in SPARE_LINES]
    DOM=domains or domain
    VALS={d:DOM(d)+['RD'] for d in DAYS}
    x={}
    for k in WORK:
        for d in DAYS:
            assert base[k][d] in VALS[d], (k,d,base[k][d])
            for v in VALS[d]: x[k,d,v]=m.NewBoolVar(f'x{k}{d}{v}')
            m.AddExactlyOne(x[k,d,v] for v in VALS[d])
    # the sequence
    POS=[(k,d) for k in LINES for d in DAYS]; N=len(POS)
    spare=lambda i: int(POS[i][0]) in SPARE_LINES
    def lin(i, f):   # sum of x over values v with f(v) at position i (non-spare)
        k,d=POS[i]; return sum(x[k,d,v] for v in VALS[d] if v!='RD' and f(v))
    def R(i): k,d=POS[i]; return x[k,d,'RD']
    W=lambda i: 1 if spare(i) else 1-R(i)
    E=lambda i: 0 if spare(i) else lin(i, lambda v: 300<=st(v)<420)
    H8=lambda i: lin(i, lambda v: dur(v)>=480)
    D=lambda i: 0 if spare(i) else sum(dur(v)*x[POS[i][0],POS[i][1],v] for v in VALS[POS[i][1]] if v!='RD')
    cnt=lambda d,f: sum(x[k,d,v] for k in WORK for v in VALS[d] if v!='RD' and f(v))
    cntv=lambda d,v: sum(x[k,d,v] for k in WORK)
    # ── the 11 rules ─────────────────────────────────────────────
    WD=['mon','tue','wed','thu','fri']
    for d in DAYS:
        c=cls(d)
        if 'open' in parts: m.Add(cnt(d, lambda v: st(v)==OPEN[c])>=4)
        if 'close' in parts: m.Add(cnt(d, lambda v: en(v)==CLOSE[c])>=3)
        if 'at22' in parts: m.Add(cnt(d, lambda v: en(v)>1320)>=5)
    if 'heads' in parts: m.Add(cnt('sat', lambda v: True)>=14); m.Add(cnt('sun', lambda v: True)>=10)
    for d in WD:
        if 'office' in parts: m.Add(cntv(d,'06:20-14:20')>=2); m.Add(cntv(d,'14:00-22:30')>=2)
        for v in domain(d):
            if 'closer' in parts and en(v)==1435 and v!='15:45-23:55': m.Add(cntv(d,v)==0)
    if 'closer' in parts: m.Add(sum(cnt(d, lambda v: en(v)==1435) for d in WD)>=1)   # wkClosers.length > 0
    if 'office' in parts: m.Add(cntv('sat','06:20-14:50')>=2); m.Add(cntv('sat','14:30-22:00')>=2)
    # Sunday pairs, selected exactly as rosteredPairs does
    SE=sorted([v for v in domain('sun') if st(v)==435], key=lambda v:-en(v))    # latest end first
    SL=sorted([v for v in domain('sun') if en(v)==1350], key=lambda v:st(v))     # earliest start first
    g={}
    for v in SE+SL:
        g[v]=m.NewBoolVar('g'+v); m.Add(cntv('sun',v)>=2).OnlyEnforceIf(g[v]); m.Add(cntv('sun',v)<=1).OnlyEnforceIf(g[v].Not())
    def selectors(L):
        sel={}
        for i,v in enumerate(L):
            s=m.NewBoolVar('sel'+v); sel[v]=s
            m.AddBoolAnd([g[v]]+[g[u].Not() for u in L[:i]]).OnlyEnforceIf(s)
            m.AddBoolOr([g[v].Not()]+[g[u] for u in L[:i]]).OnlyEnforceIf(s.Not())
        if 'office' in parts or 'floorhand' in parts: m.AddExactlyOne(sel.values())
        return sel
    selE=selectors(SE); selL=selectors(SL)
    # used-on-day booleans
    used={}
    for d in DAYS:
        for v in domain(d):
            u=m.NewBoolVar(f'u{d}{v}'); used[d,v]=u
            m.Add(cntv(d,v)>=1).OnlyEnforceIf(u); m.Add(cntv(d,v)==0).OnlyEnforceIf(u.Not())
    # floor + handover, per day, per pair combination
    for d in (DAYS if 'floorhand' in parts else []):
        c=cls(d)
        m.Add(cnt(d, lambda v: en(v)==CLOSE[c])>=1)   # handover needs a floor closer to exist (cl.length > 0)
        combos=[((PAIRS_FIXED[c][0],PAIRS_FIXED[c][1]),[]) ] if c!='sun' else [((e,l),[selE[e],selL[l]]) for e in SE for l in SL]
        for (pe,pl),enf in combos:
            hp=[]
            for t in (pe,pl):
                if st(t)==OPEN[c]:
                    e2=min(en(t),540 if c=='sun' else 480)
                    if e2>st(t): hp.append((st(t),e2))
                elif c!='sun' and en(t)>1170: hp.append((max(st(t),1170),en(t)))
            ticks=sorted({OPEN[c]}|{t for v in domain(d) for t in (st(v),en(v)) if OPEN[c]<=t<CLOSE[c]}|{t for h in hp for t in h if OPEN[c]<=t<CLOSE[c]})
            for tk in ticks:
                cov=cnt(d, lambda v: st(v)<=tk<en(v)) - 2*(st(pe)<=tk<en(pe)) - 2*(st(pl)<=tk<en(pl)) + sum(1 for h in hp if h[0]<=tk<h[1])
                ct=m.Add(cov>=2)
                if enf: ct.OnlyEnforceIf(enf)
            # handover: every floor closer has a floor duty starting before it and running 15 minutes past its start
            for cv in [v for v in domain(d) if en(v)==CLOSE[c]]:
                Q=lambda v: st(v)<st(cv) and en(v)>=st(cv)+15
                ct=m.Add(cnt(d,Q) - 2*Q(pe) - 2*Q(pl) >= 1); ct.OnlyEnforceIf([used[d,cv]]+enf)
                if c=='sun':
                    for t in [v for v in domain(d) if st(v)==OPEN['sun'] and en(v)<st(cv)+15]:
                        # a FLOOR opener t (beyond the office pair) must stay until 15 minutes after this closer arrives
                        ct=m.Add(cntv(d,t) <= (2 if t==pe else 0)); ct.OnlyEnforceIf([used[d,cv]]+enf)
            assert en(pe)-st(pl)>=20
    # no more shift times than today (18), across working lines, every day
    tu={}
    for v in U:
        tu[v]=m.NewBoolVar('t'+v)
        for k in WORK:
            for d in DAYS:
                if (k,d,v) in x: m.AddImplication(x[k,d,v], tu[v])
    if 'times' in parts: m.Add(sum(tu.values())<=18)
    # the contract: Mon–Sat duty minutes exactly 20 x 35h
    if 'contract' in parts: m.Add(sum(D(i) for i in range(N) if POS[i][1]!='sun')==42000)
    # ── hard: 12h rest between adjacent timed duties; worst-case run ≤ 13 ─────────────
    def adj_pairs():
        for i in range(N):
            j=(i+1)%N
            if not spare(i) and not spare(j): yield i,j
    for i,j in adj_pairs():
        (k1,d1),(k2,d2)=POS[i],POS[j]
        for v in domain(d1):
            bad=[w for w in domain(d2) if (1440-en(v))+st(w)<720]
            if bad and 'rest' in parts: m.Add(x[k1,d1,v]+sum(x[k2,d2,w] for w in bad)<=1)
    before=[i for i in range(N) if not spare(i) and spare((i+1)%N)]   # Sat before a cover week
    after=[i for i in range(N) if not spare(i) and spare((i-1)%N)]    # Sun after one
    def pure_windows(L):
        for i in range(N):
            idx=[(i+t)%N for t in range(L)]
            if not any(spare(q) for q in idx): yield idx
    if 'run' in parts:
        for idx in pure_windows(14): m.Add(sum(W(q) for q in idx)<=13)
        for b in before: m.Add(sum(W((b-t)%N) for t in range(10))<=9)
        for a in after: m.Add(sum(W((a+t)%N) for t in range(10))<=9)
    # ── the fatigue factors ─────────────────────────────────────
    z={f:m.NewBoolVar(f) for f in ['FF8b','FF11','FF15','MRSF12','MRSF55','MRSF8h','FF17','FF19']}
    for idx in pure_windows(5): m.Add(sum(E(q) for q in idx)-4<=z['FF15'])
    for b in before: m.Add(E(b)<=z['FF15'])
    for idx in pure_windows(8): m.Add(sum(H8(q) for q in idx)-7<=z['MRSF8h'])
    for b in before: m.Add(sum(H8((b-t)%N) for t in range(4))-3<=z['MRSF8h'])
    for a in after: m.Add(sum(H8((a+t)%N) for t in range(4))-3<=z['MRSF8h'])
    for idx in pure_windows(13): m.Add(sum(W(q) for q in idx)-12<=z['MRSF12'])
    for b in before: m.Add(sum(W((b-t)%N) for t in range(9))-8<=z['MRSF12'])
    for a in after: m.Add(sum(W((a+t)%N) for t in range(9))-8<=z['MRSF12'])
    for i in range(N):
        m.Add(sum(D((i+t)%N) for t in range(7))-3300 <= 2000*z['MRSF55'])
    # FF8b: a block of 2+ earlies must be followed by two rest days
    for i in range(N):
        a,b,c1,c2=(i-1)%N,i,(i+1)%N,(i+2)%N
        if spare(a) or spare(b): continue
        q=m.NewBoolVar(f'q{i}')
        if spare(c1) or spare(c2): m.Add(q==0)
        else: m.Add(q<=R(c1)); m.Add(q<=R(c2))
        m.Add(E(a)+E(b)-E(c1)-q-1<=z['FF8b'])
    # FF11: compressed sequence, a cover week = four shifts and never a break
    comp=[]
    for k in LINES:
        if int(k) in SPARE_LINES: comp+= [('S',None)]*4
        else: comp+=[('C',(k,d)) for d in DAYS]
    M=len(comp)
    sh=lambda t: 1 if comp[t][0]=='S' else 1-x[comp[t][1][0],comp[t][1][1],'RD']
    brk=[]
    for t in range(M):
        u=(t+1)%M
        if comp[t][0]=='S' or comp[u][0]=='S': brk.append(0); continue
        bb=m.NewBoolVar(f'b{t}'); m.Add(bb<=x[comp[t][1][0],comp[t][1][1],'RD']); m.Add(bb<=x[comp[u][1][0],comp[u][1][1],'RD']); brk.append(bb)
    for i in range(M):
        for L in range(14,28):
            idx=[(i+t)%M for t in range(L)]
            m.Add(sum(sh(t) for t in idx)-13 <= L*z['FF11'] + L*sum(brk[t] for t in idx[:-1]))
    # FF19 / FF17 over adjacent timed pairs
    bw=[]; fw=[]
    for i,j in adj_pairs():
        (k1,d1),(k2,d2)=POS[i],POS[j]
        b=m.NewBoolVar(f'bw{i}'); f=m.NewBoolVar(f'fw{i}'); bw.append(b); fw.append(f)
        m.Add(f<=1-x[k1,d1,'RD'])
        for v in domain(d1):
            jump=[w for w in domain(d2) if abs(st(w)-st(v))>120]
            if jump: m.Add(x[k1,d1,v]+sum(x[k2,d2,w] for w in jump)<=1+z['FF19'])
            earlier=[w for w in domain(d2) if st(w)<st(v)]
            if earlier: m.Add(b>=x[k1,d1,v]+sum(x[k2,d2,w] for w in earlier)-1)
            m.Add(f<=1-x[k1,d1,v]+sum(x[k2,d2,w] for w in domain(d2) if st(w)>st(v)))
    m.Add(sum(bw)-sum(fw) <= 400*z['FF17'])
    # ── objectives ──────────────────────────────────────────────
    changes=sum(1-x[k,d,base[k][d]] for k in WORK for d in DAYS)
    factors=sum(z.values())
    if fmax is not None: m.Add(factors<=fmax)
    if cmax is not None: m.Add(changes<=cmax)
    for f in forbid_factors: m.Add(z[f]==0)
    if fix:
        for (k,d),v in fix.items(): m.Add(x[k,d,v]==1)
    return m, x, z, changes, factors, WORK
PAIRS_FIXED={'wk':('06:20-14:20','14:00-22:30'),'sat':('06:20-14:50','14:30-22:00')}

def extract(solver,x,WORK,base=FT):
    p={k:dict(base[k]) for k in base}
    for (k,d,v),var in x.items():
        if solver.Value(var): p[k][d]=v
    return p

if __name__=='__main__':
    mode=sys.argv[1]; T=float(sys.argv[2]) if len(sys.argv)>2 else 600
    fmax=int(sys.argv[3]) if len(sys.argv)>3 and sys.argv[3]!='-' else None
    cmax=int(sys.argv[4]) if len(sys.argv)>4 and sys.argv[4]!='-' else None
    m,x,z,changes,factors,WORK=build(fmax=fmax,cmax=cmax)
    if mode=='changes': m.Minimize(changes)
    elif mode=='factors': m.Minimize(factors)
    elif mode=='lex': m.Minimize(100*changes+factors)
    elif mode=='lexf': m.Minimize(1000*factors+changes)
    s=cp_model.CpSolver(); s.parameters.max_time_in_seconds=T; s.parameters.num_workers=4; s.parameters.log_search_progress=False
    t0=time.time(); r=s.Solve(m)
    print('status',s.StatusName(r),'obj',s.ObjectiveValue() if r in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None,'bound',s.BestObjectiveBound(),'time',round(time.time()-t0,1))
    if r in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        p=extract(s,x,WORK)
        print('changes',s.Value(changes),'factors',s.Value(factors),{f:s.Value(v) for f,v in z.items() if s.Value(v)})
        out=sys.argv[5] if len(sys.argv)>5 else f'sol-{mode}.json'
        json.dump(p,open(out,'w'),indent=1); print('wrote',out)
