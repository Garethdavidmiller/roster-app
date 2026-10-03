"""Independent recount of a candidate against the supplied Second Gear grid.
No external libraries. Uses the pack's definitions; not the original app checker.
Usage: python3 verify.py BASELINE_IMPORT CANDIDATE_IMPORT
"""
import sys,json,collections,itertools,math
from pathlib import Path

def load(p):
 rows=[l.split('\t')[1:] for l in Path(p).read_text().splitlines() if l.strip()]
 assert len(rows)==26 and all(len(r)==7 for r in rows)
 return rows

def mins(s):
 h,m=map(int,s.split(':'));return 60*h+m

def measure(rows):
 seq=[None if x in ('SP','RD') else tuple(map(mins,x.split('-'))) for r in rows for x in r]
 raw=sum(rows,[]); N=len(seq); work=[x is not None for x in seq]
 def run(a):
  s=best=0
  for x in a*2:s=s+1 if x else 0;best=max(s,best)
  return best
 def no_two_day_break(a):
  best=s=0
  for i in range(N*2):
   if not a[i%N] and not a[(i-1)%N]:s=0
   elif a[i%N]:s+=1
   best=max(best,s)
  return best
 covers=[i for i,r in enumerate(rows) if all(x=='SP' for x in r)]
 worst=run(work); ff11worst=no_two_day_break(work)
 for r in covers:
  for days in itertools.combinations(range(7),4):
   a=work.copy()
   for d in days:a[r*7+d]=True
   worst=max(worst,run(a));ff11worst=max(ff11worst,no_two_day_break(a))
 # Confirm fixed two-day breaks separate cover weeks, so no FF11 run can span two covers.
 separated=True
 for pos,r in enumerate(covers):
  end=covers[(pos+1)%len(covers)]
  distance=(end-r)%26
  section=[raw[(r*7+7+i)%N] for i in range((distance-1)*7)]
  separated &= any(section[i]=='RD' and section[i+1]=='RD' for i in range(len(section)-1))
 assert separated
 rests=[]
 for i,v in enumerate(seq):
  if v is not None:
   j=next(k for k in range(1,N+1) if seq[(i+k)%N] is not None)
   rests.append(j*1440+seq[(i+j)%N][0]-v[1])
 weekend=[r for r in range(26) if rows[r][6]=='RD' and rows[(r+1)%26][0]=='RD']
 gaps=[(weekend[(i+1)%len(weekend)]-v)%26 for i,v in enumerate(weekend)]
 means=[];mixed=[];one=[];mh=[];ah=[]
 for r in range(26):
  line=seq[r*7:r*7+7];v=[x for x in line if x is not None];starts=[x[0] for x in v]
  mix=bool(starts and min(starts)<660<=max(starts))
  if mix:mixed.append(r+1)
  times={x for x in line[1:6] if x is not None}
  if len(times)==1 and not mix:one.append(r+1)
  means.append(sum(starts)/len(starts) if starts else None)
  mh.append(sum(b-a for x in line[1:] if x is not None for a,b in [x]))
  ah.append(sum(b-a for a,b in v))
 diffs=[means[(i+1)%26]-v for i,v in enumerate(means) if v is not None and means[(i+1)%26] is not None]
 adjacent=[seq[(i+1)%N][0]-v[0] for i,v in enumerate(seq) if v is not None and seq[(i+1)%N] is not None]
 early=[v is not None and 300<=v[0]<420 for v in seq]
 earlybad=[]
 for i in range(N):
  if early[i] and early[(i-1)%N] and not early[(i+1)%N] and raw[(i+1)%N]!='SP':
   if work[(i+1)%N] or work[(i+2)%N]:earlybad.append(i)
 rolling=max(sum(b-a for j in range(7) if (x:=seq[(i+j)%N]) is not None for a,b in [x]) for i in range(N))
 def leave_cost(start,n):
  fixed=0;sp=collections.Counter()
  for t in range(start,start+n):
   if t%7==0:continue
   if raw[t%N]=='SP':sp[t//7]+=1
   elif work[t%N]:fixed+=1
  return fixed+sum(min(4,v) for v in sp.values())
 leave=[]
 for start in range(N):
  n=0
  while leave_cost(start,n+1)<=14:n+=1
  leave.append(n)
 days=sum(x is not None for i,x in enumerate(seq) if i%7)+4*len(covers)
 earlymax=run(early)
 warnings={'FF8b':len(earlybad)>0,'FF15':earlymax>4,'FF19':any(abs(x)>120 for x in adjacent),'FF17':sum(x<0 for x in adjacent)>sum(x>0 for x in adjacent),'MRSF55':rolling>3300,'FF11':no_two_day_break(work)>13,'FF13':min(rests)<720,'MRSF12':run(work)>12,'MRSF8':run([x is not None and x[1]-x[0]>=480 for x in seq])>7}
 return dict(contract_minutes=sum(mh)+len(covers)*2100,fixed_monsat_minutes=sum(mh),contracted_days_year=days/26*365/7,cover_lines=[i+1 for i in covers],weekend_saturday_lines=[i+1 for i in weekend],weekend_gaps=gaps,weekends=len(weekend),max_weekend_gap=max(gaps),fixed_max_run=run(work),worst_cover_max_run=worst,min_fixed_rest=min(rests),mixed_weeks=mixed,one_turn_weeks=one,single_rest_days=sum(raw[i]=='RD' and work[(i-1)%N] and work[(i+1)%N] for i in range(N)),peak_monsat=max(mh),peak_sunday_in=max(ah),average_start_step=sum(map(abs,diffs))/len(diffs),late_finishes_year=sum(x is not None and x[1]>=1380 for x in seq)*2,shift_times=len({x for x in raw if '-' in x}),longest_duty=max(b-a for x in seq if x is not None for a,b in [x]),rolling_seven_day_minutes=rolling,early_run=earlymax,early_recovery_failures=earlybad,backward_changes=sum(x<0 for x in adjacent),forward_changes=sum(x>0 for x in adjacent),ff11_fixed=no_two_day_break(work),ff11_worst_cover=ff11worst,leave_14_best=max(leave),leave_14_average=sum(leave)/N,leave_14_worst=min(leave),leave_four_sunday_weeks=min(leave_cost(i,28) for i in range(0,N,7)),reconstructed_avoidable_flags=warnings)

if __name__=='__main__':
 baseline=load(sys.argv[1]);candidate=load(sys.argv[2]);m=measure(candidate)
 assert all(collections.Counter(r[d] for r in baseline)==collections.Counter(r[d] for r in candidate) for d in range(7)), 'Daily duties changed'
 assert m['contract_minutes']==54600 and m['fixed_monsat_minutes']==44100
 assert m['contracted_days_year']<=219 and m['min_fixed_rest']>=720
 assert m['cover_lines']==[1,6,11,16,21] and m['worst_cover_max_run']<=6
 assert m['ff11_worst_cover']<=13 and not any(m['reconstructed_avoidable_flags'].values())
 print(json.dumps({'daily_duty_multisets_identical':True,'baseline':measure(baseline),'candidate':m},indent=2))
