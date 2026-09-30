# Independent re-implementation of the sheets' rule/hard/fatigue checks, in the exact form the CP-SAT model encodes.
from common import *
TODAY_DISTINCT=18
WD=['mon','tue','wed','thu','fri']
def seq(p): return [p[str(k)][d] for k in range(1,25) for d in DAYS]
def timed(s): return s not in ('RD','SPARE','OFF')
def rest(s): return s in ('RD','OFF')
def early(s): return timed(s) and 300<=st(s)<420
def sunpair(cnt):
    e=[t for t in cnt if st(t)==435 and cnt[t]>=2]; l=[t for t in cnt if en(t)==1350 and cnt[t]>=2]
    if not e or not l: return None
    return (max(e,key=en), min(l,key=st))
PAIRS={'wk':('06:20-14:20','14:00-22:30'),'sat':('06:20-14:50','14:30-22:00')}
def pairs_on(cnt,d):
    c=cls(d)
    if c=='sun': return sunpair(cnt)
    e,l=PAIRS[c]; return (e,l) if cnt.get(e,0)>=2 and cnt.get(l,0)>=2 else None
def helpers(pr,c):
    out=[]
    for t in pr:
        if st(t)==OPEN[c]:
            e=min(en(t),540 if c=='sun' else 480)
            if e>st(t): out.append((st(t),e,1))
        elif c=='sun':
            # the December Sunday (owner, 29 Sep 2026), as report-data officeHelpers and model.py: both lates on the
            # floor until 15:00, one of them again from 18:00 (audit, 30 Sep 2026 — this was the old half-share model)
            if st(t)<900: out += [(st(t),900,1),(st(t),900,1)]
            out.append((max(st(t),1080),en(t),1))
        elif en(t)>1170: out.append((max(st(t),1170),en(t),1))
    return out
def rules(p):
    lines=[str(k) for k in range(1,25)]
    duties={d:[p[k][d] for k in lines if timed(p[k][d])] for d in DAYS}
    cnts={d:{} for d in DAYS}
    for d in DAYS:
        for s in duties[d]: cnts[d][s]=cnts[d].get(s,0)+1
    r={}
    r['open']=all(sum(1 for s in duties[d] if s.startswith('07:15' if d=='sun' else '06:20'))>=4 for d in DAYS)
    r['close']=all(sum(1 for s in duties[d] if s.endswith('23:25' if d=='sun' else '23:55'))>=3 for d in DAYS)
    r['at22']=all(sum(1 for s in duties[d] if en(s)>1320)>=5 for d in DAYS)
    daily={d:sum(1 for k in lines if p[k][d] not in ('RD','SPARE')) for d in DAYS}
    r['heads']=daily['sat']>=14 and daily['sun']>=10
    spare=[int(k) for k in lines if p[k]['mon']=='SPARE']
    r['cover']=len(spare)==4 and all(((spare[(i+1)%4]-spare[i])%24)==6 for i in range(4))
    prs={d:pairs_on(cnts[d],d) for d in DAYS}
    r['office']=all(prs[d] for d in DAYS)
    cl=[s for d in WD for s in duties[d] if en(s)==1435]
    r['closer']=len(cl)>0 and all(s=='15:45-23:55' for s in cl)
    fm={}; hv={}
    for d in DAYS:
        c=cls(d); pr=prs[d]
        ds=[(s,st(s),en(s)) for s in duties[d]]
        if pr:
            for t in (pr[0],pr[0],pr[1],pr[1]):
                i=next(i for i,x in enumerate(ds) if x[0]==t); ds.pop(i)
            office=[]; hp=helpers(pr,c)
        else:
            import sys
            office=None; hp=None
        if pr is None:
            fm[d]=None; hv[d]=None; continue
        lo=10**9; m=OPEN[c]
        while m<CLOSE[c]:
            v=sum(1 for x in ds if x[1]<=m<x[2])+sum(1 for h in hp if h[2]>=1 and h[0]<=m<h[1]); lo=min(lo,v); m+=5
        fm[d]=max(0,lo)
        cls_=[x for x in ds if x[2]==CLOSE[c]]
        ok=len(cls_)>0 and all(any(x[1]<y[1] and x[2]>=y[1]+15 for x in ds) for y in cls_)
        if c=='sun' and cls_:
            last=max(y[1] for y in cls_); ok=ok and all(x[2]>=last+15 for x in ds if x[1]==OPEN['sun'])
        # the office handover: 20 minutes, and on a Sunday 30 counted from 15:00, when both lates come off the floor
        hv[d]=(ok, en(pr[0])-max(st(pr[1]),900) if c=='sun' else en(pr[0])-st(pr[1]), 30 if c=='sun' else 20)
    r['floor']=all(fm[d] is not None and fm[d]>=2 for d in DAYS) if r['office'] else None
    r['handover']=all(hv[d][0] and hv[d][1]>=hv[d][2] for d in DAYS) if r['office'] else None
    r['sunlen']=len(duties['sun'])>0 and all(480<=dur(s)<=540 for s in duties['sun'])
    work=[k for k in lines if p[k]['mon']!='SPARE']
    r['times']=len({p[k][d] for k in work for d in DAYS if p[k][d]!='RD'})<=TODAY_DISTINCT
    return r
def monsat(p): return sum(dur(p[str(k)][d]) for k in range(1,25) for d in DAYS[1:] if timed(p[str(k)][d]))
def run_lengths(S,counts,require=False):
    N=len(S); out=[]
    for start in range(N):
        spent={}; run=0; saw=False
        for k in range(N):
            i=(start+k)%N; s=S[i]
            if s=='SPARE':
                ln=i//7; u=spent.get(ln,0)
                if u>=4: break
                spent[ln]=u+1; run+=1
            elif counts(s): run+=1; saw=True
            else: break
        out.append(0 if require and not saw else min(run,N))
    return out
def ff11(S):
    N=len(S)
    spareweeks={i//7 for i in range(N) if S[i]=='SPARE'}
    total=sum(1 for s in S if not rest(s) and s!='SPARE')+4*len(spareweeks)
    if not any(rest(S[i]) and rest(S[(i+1)%N]) for i in range(N)): return total
    best=run=rr=0; spent={}
    for i in range(2*N):
        s=S[i%N]
        if s=='SPARE':
            ln=i//7; u=spent.get(ln,0)
            if u<4:
                if rr>=2: run=0
                spent[ln]=u+1; rr=0; run+=1; best=max(best,run)
            continue
        if not rest(s):
            if rr>=2: run=0
            rr=0; run+=1; best=max(best,run)
        else: rr+=1
    return min(best,total)
def factors(p):
    S=seq(p); N=len(S); f={}
    # FF8b
    bad=False
    for i in range(N):
        if early(S[i-1]) and early(S[i]) and not early(S[(i+1)%N]) and not (rest(S[(i+1)%N]) and rest(S[(i+2)%N])): bad=True
    if all(early(s) for s in S): bad=True
    f['FF8b']=bad
    f['FF11']=ff11(S)>13
    f['FF15']=max(run_lengths(S,early,True))>4
    f['MRSF12']=max(run_lengths(S,lambda s: not rest(s)))>12
    best=0
    for i in range(N):
        best=max(best,sum(dur(S[(i+k)%N]) for k in range(7) if timed(S[(i+k)%N])))
    f['MRSF55']=round(best/60*10)/10>55
    f['MRSF8h']=max(run_lengths(S,lambda s: timed(s) and dur(s)>=480,True))>7
    b=fw=0; j=0
    for i in range(N):
        a,c=S[i],S[(i+1)%N]
        if rest(a) or rest(c) or not timed(a) or not timed(c): continue
        if st(c)<st(a): b+=1
        elif st(c)>st(a): fw+=1
        if abs(st(c)-st(a))>120: j+=1
    f['FF17']=b>fw; f['FF19']=j>0
    f['FF13']=turnarounds(S)>0
    return f
def turnarounds(S):
    N=len(S); n=0
    for i in range(N):
        a,c=S[i],S[(i+1)%N]
        if timed(a) and timed(c) and (1440-en(a))+st(c)<720: n+=1
    return n
def judge(p):
    S=seq(p)
    return dict(rules=rules(p), factors=factors(p), turn=turnarounds(S), run=max(run_lengths(S,lambda s: not rest(s))), monsat=monsat(p))
