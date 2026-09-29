# Writes wl-spec.json for mixsa.mjs: Weekday Lates' Sunday–Saturday columns (working lines only) and each day's allowed
# shift times — the exact model's pool with WIDE=1 (every time any sheet uses), a weekday closer only at 15:45 or 16:25.
#   BASE=../../Weekday-Lates-WL-24-EXT.json WIDE=1 SPARES=1,7,12,17 python3 mixspec.py
import os, sys, json
sys.argv=['x','0','0','/dev/null','1']
import importlib.util
if not os.path.exists('tiebreak_model.py') or os.path.getmtime('tiebreak_model.py')<os.path.getmtime('tiebreak.py'):
    open('tiebreak_model.py','w').write(open('tiebreak.py').read().split("stages=(sys.argv[6]")[0])
spec=importlib.util.spec_from_file_location('tb','tiebreak_model.py'); tb=importlib.util.module_from_spec(spec); spec.loader.exec_module(tb)
B=tb.BASE; work=[str(k) for k in range(1,25) if k not in tb.SPS]
D=['sun','mon','tue','wed','thu','fri','sat']
dom={d:[v for v in tb.domain(d) if not (d not in ('sat','sun') and v.endswith('23:55') and v not in ('15:45-23:55','16:25-23:55'))] for d in D}
json.dump({'domain':dom,'base':{d:[B[k][d] for k in work] for d in D}},open('wl-spec.json','w'))
print('wl-spec.json', {d:len(dom[d]) for d in D})
