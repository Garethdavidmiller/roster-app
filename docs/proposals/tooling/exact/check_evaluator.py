# Checks evaluator.py against the SHEETS' OWN CODE (jsjudge.mjs) on every shipped design and random edits of each.
#   python3 check_evaluator.py <seed> <edits-per-design>      e.g. 3 50 -> 1,224 grids
import sys, json, random, glob, subprocess, copy, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from common import *
from evaluator import judge
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
bases=[load(f) for f in sorted(glob.glob(PROP+'*-24-*.json'))]
grids=[]
for b in bases:
    grids.append(b)
    for _ in range(int(sys.argv[2]) if len(sys.argv)>2 else 40):
        g=copy.deepcopy(b)
        for _ in range(random.randint(1,25)):
            k=str(random.randint(1,24))
            if g[k]['mon']=='SPARE': continue
            d=random.choice(DAYS)
            r=random.random()
            if r<0.2: g[k][d]='RD'
            elif r<0.35:  # swap within day
                k2=str(random.randint(1,24))
                if g[k2]['mon']!='SPARE': g[k][d],g[k2][d]=g[k2][d],g[k][d]
            else: g[k][d]=random.choice(domain(d))
        grids.append(g)
json.dump(grids,open('vgrids.json','w'))
subprocess.run(['node',os.path.join(os.path.dirname(os.path.abspath(__file__)),'jsjudge.mjs'),'vgrids.json','vjs.json'],check=True)
js=json.load(open('vjs.json'))
MAP={'FF8b':'FF8b','FF11':'FF11','FF15':'FF15','MRSF12':'MRSF:More than 12 consecutive day shifts','MRSF55':'MRSF:More than 55 hours worked in any 7-day period','MRSF8h':'MRSF:More than 7 consecutive 8h shifts','FF17':'FF17','FF19':'FF19','FF13':'FF13'}
bad=0; fc={}
for g,J in zip(grids,js):
    P=judge(g); errs=[]
    for k,v in P['rules'].items():
        jv=J['rules'][k]
        if v is None: 
            if jv and J['rules']['office']: errs.append(('rule-none',k))
        elif v!=jv: errs.append(('rule',k,v,jv))
    for k,v in P['factors'].items():
        jv=J['factors'].get(MAP[k],False)
        if v!=jv: errs.append(('factor',k,v,jv))
        fc[k]=fc.get(k,0)+v
    extra=set(J['factors'])-set(MAP.values())
    if extra: errs.append(('unmodelled',extra))
    if P['turn']!=J['turn']: errs.append(('turn',P['turn'],J['turn']))
    if P['run']!=J['run']: errs.append(('run',P['run'],J['run']))
    if P['monsat']!=J['monSat']: errs.append(('monsat',P['monsat'],J['monSat']))
    if sum(P['factors'].values())!=J['present']: errs.append(('present',sum(P['factors'].values()),J['present']))
    if errs:
        bad+=1
        if bad<=5: print(errs)
print('grids',len(grids),'mismatches',bad,'factor positives',fc)
