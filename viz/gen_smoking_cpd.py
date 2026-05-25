"""
gen_smoking_cpd.py

Generates viz/examples/smoking-cpd.json — the canonical smoking model from the
PDG paper, with all CPD tables serialized so the inspector panel can display them.

Run from the pdg/ directory:
    python3 viz/gen_smoking_cpd.py

The CPD format written into the JSON is:
    { srcCombo: { tgtState: probability } }

e.g. for P(C | S, SH):
    {
      "s, sh":   { "c": 0.60, "~c": 0.40 },
      "s, ~sh":  { "c": 0.40, "~c": 0.60 },
      "~s, sh":  { "c": 0.10, "~c": 0.90 },
      "~s, ~sh": { "c": 0.01, "~c": 0.99 }
    }

This matches what buildCpdTable() in pdgviz.js expects.
"""

import sys, json, math
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[2]))

from pdg import PDG
from pdg.dist import CPT
from pdg.rv import binvar, Unit


# ── 1. Build the model ────────────────────────────────────────────────────────

M = PDG()
PS = binvar('PS')   # Parental Smoking
S  = binvar('S')    # Smoking
SH = binvar('SH')   # Secondhand smoke
C  = binvar('C')    # Cancer

M += CPT.from_ddict(Unit, PS, {'⋆': 0.3})                     # prior on PS
M += CPT.from_ddict(PS, S,  {'ps': 0.4,  '~ps': 0.2})         # PS → S
M += CPT.from_ddict(PS, SH, {'ps': 0.8,  '~ps': 0.3})         # PS → SH
M += CPT.from_ddict(S & SH, C, {                               # S,SH → C
    ('s',  'sh'):  0.60,
    ('s',  '~sh'): 0.40,
    ('~s', 'sh'):  0.10,
    ('~s', '~sh'): 0.01,
})


# ── 2. Get hypergraph structure ────────────────────────────────────────────────

nodes, hedges = M.hypergraph_object


# ── 3. Serialize CPDs (only for edges that appear in the hypergraph) ──────────

def serialize_cpd(cpd):
    """
    Convert a CPT (pandas DataFrame) to the nested-dict format the inspector
    expects:  { srcCombo: { tgtState: probability } }

    Multi-source rows have tuple indices like ('s', 'sh') — join them as "s, sh".
    Single-source rows are plain strings.
    """
    result = {}
    for row_key, row in cpd.iterrows():
        if isinstance(row_key, tuple):
            combo_str = ', '.join(str(v) for v in row_key)
        else:
            combo_str = str(row_key)
        result[combo_str] = {str(col): round(float(val), 6) for col, val in row.items()}
    return result


# Only serialize edges whose labels appear in hedges (skip internal π edges)
hedge_labels = set(hedges.keys())
cpds = {}
for X, Y, cpd, label in M.edges("XYPl"):
    if label in hedge_labels and cpd is not None:
        cpds[label] = serialize_cpd(cpd)


# ── 4. Layout positions (diamond topology) ────────────────────────────────────

viz_nodes = {
    "PS": {"x": 400, "y": 130, "w": 50, "h": 40},
    "S":  {"x": 230, "y": 340, "w": 50, "h": 40},
    "SH": {"x": 570, "y": 340, "w": 50, "h": 40},
    "C":  {"x": 400, "y": 550, "w": 50, "h": 40},
}

viz_linknodes = [
    ["p1", {"x": 400, "y":  60,  "w": 10, "h": 10}],  # prior → PS
    ["p2", {"x": 290, "y": 235,  "w": 10, "h": 10}],  # PS → S
    ["p3", {"x": 510, "y": 235,  "w": 10, "h": 10}],  # PS → SH
    ["p4", {"x": 400, "y": 455,  "w": 10, "h": 10}],  # S,SH → C
]


# ── 5. Write output ───────────────────────────────────────────────────────────

output = {
    "nodes": nodes,
    "hedges": hedges,
    "cpds": cpds,
    "viz": {
        "nodes": viz_nodes,
        "linknodes": viz_linknodes,
    }
}

out_path = __import__('pathlib').Path(__file__).parent / "examples" / "smoking-cpd.json"
with open(out_path, "w") as f:
    json.dump(output, f, indent=2)

print(f"Written: {out_path}")
print(f"  nodes:  {nodes}")
print(f"  edges:  {list(hedges.keys())}")
print(f"  cpds:   {list(cpds.keys())}")
print()

for label, cpd_dict in cpds.items():
    hedge = hedges[label]
    srcs, tgts = hedge
    src_str = ', '.join(srcs) if srcs else '∅ (prior)'
    tgt_str = ', '.join(tgts)
    print(f"  {label}:  P({tgt_str} | {src_str})")
    for combo, dist in cpd_dict.items():
        row = '  '.join(f"{k}={v:.2f}" for k, v in dist.items())
        print(f"    [{combo}]  {row}")
    print()
