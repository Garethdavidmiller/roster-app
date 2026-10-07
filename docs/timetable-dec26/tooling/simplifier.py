import sys, json, re, datetime, openpyxl, warnings
warnings.filterwarnings('ignore')
def t(v):
    """Return (minutes, ecs) or None. Handles 'HH:MM', 'HH+MM' (ECS), 'HH:MM:SS', time objects and Excel serial fractions."""
    if v is None or v == '': return None
    if isinstance(v, datetime.time): return (v.hour*60+v.minute, False)
    if isinstance(v, datetime.datetime): return (v.hour*60+v.minute, False)
    if isinstance(v, (int, float)):
        m = round(float(v) * 1440); return (m % 1440, False)
    s = str(v).strip()
    m = re.match(r'^(\d{1,2})([:+])(\d{2})', s)
    if not m: return None
    return (int(m.group(1))*60+int(m.group(3)), m.group(2) == '+')
out = {}
for key, path in [('SX', sys.argv[1]), ('SO', sys.argv[2]), ('SU', sys.argv[3])]:
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    deps, arrs = [], []
    for r in ws.iter_rows(min_row=1, values_only=True):
        r = list(r) + [None]*14
        a_hc, a_dep, a_org, a_arr = r[0], r[1], r[2], r[3]
        plat, d_hc, d_dep, d_dest, cars, udiag = r[6], r[7], r[8], r[9], r[11], r[13]
        if a_hc and str(a_hc).strip() not in ('Train No.',) and t(a_arr):
            m, ecs = t(a_arr)
            arrs.append(dict(hc=str(a_hc).strip(), org=str(a_org or '').strip(), arr=m, ecs=ecs or str(a_hc).strip().startswith('5'), plat=str(plat or '').strip(), cars=str(cars or '').strip()))
        if d_hc and str(d_hc).strip() not in ('Train No.',) and t(d_dep):
            m, ecs = t(d_dep)
            deps.append(dict(hc=str(d_hc).strip(), dest=str(d_dest or '').strip(), dep=m, ecs=ecs or str(d_hc).strip().startswith('5'), plat=str(plat or '').strip(), cars=str(cars or '').strip(), diag=str(udiag or '').replace('\n','/')))
    out[key] = dict(deps=deps, arrs=arrs)
json.dump(out, open(sys.argv[4], 'w'), indent=1)
for k, v in out.items():
    pd = [d for d in v['deps'] if not d['ecs']]; pa = [a for a in v['arrs'] if not a['ecs']]
    print(k, 'deps', len(v['deps']), 'passenger deps', len(pd), '| arrs', len(v['arrs']), 'passenger arrs', len(pa))
