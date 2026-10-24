#!/usr/bin/env python3
"""Compare behaviour probes from the clone WITHOUT Phase 1 (before) and WITH it (after)."""
import sys
before_f, after_f, exp_f, name = sys.argv[1:5]
def load(p):
    d = {}
    for line in open(p):
        line = line.rstrip("\n")
        if not line: continue
        k, _, v = line.partition("|")
        d[k] = v
    return d
b, a = load(before_f), load(after_f)
prefixes = [l.strip() for l in open(exp_f) if l.strip() and not l.startswith("#")]
bad = []; changed = 0; same = 0
for k in sorted(set(b) | set(a)):
    rb, ra = b.get(k), a.get(k)
    expected = any(k.startswith(p) for p in prefixes)
    if rb is None or ra is None:
        bad.append(f"probe missing on one side: {k}"); continue
    if expected:
        if not ra.startswith("42501:permission denied"):
            bad.append(f"{k}: expected permission denied after Phase 1, got {ra!r} (before {rb!r})")
        elif rb != ra: changed += 1
    else:
        if rb != ra: bad.append(f"{k}: BEHAVIOUR CHANGED  before={rb!r}  after={ra!r}")
        else: same += 1
tot_exp = sum(1 for k in b if any(k.startswith(p) for p in prefixes))
print(f"{name}: {same} legitimate/flow probes identical before/after; {changed}/{tot_exp} closure probes flipped to permission-denied")
if bad:
    print("\n".join("FAIL: " + x for x in bad)); sys.exit(1)
print(f"PASS: {name}: no behavioural regression; all intended closures are permission-denied")
