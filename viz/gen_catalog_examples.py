"""Generate the dissertation example JSONs catalogued in
`dissertation/examples-catalog.md`.

Every model here is pinned to explicit `viz` coordinates so that it loads looking
like the figure in the dissertation, deterministically, on every load. Force
layout is for authoring; these are for reading.

Run:  python3 viz/gen_catalog_examples.py
"""

import json
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples")

NODE_W, NODE_H = 50, 40
LINK_W, LINK_H = 10, 10

UNIT = "⋆"  # ⋆ — the nullary source key


def model(nodes, hedges, positions, linkpositions,
          cpds=None, alpha=None, beta=None):
    """Assemble a viz-JSON model with pinned layout."""
    doc = {
        "nodes": list(nodes),
        "hedges": hedges,
    }
    if cpds:
        doc["cpds"] = cpds
    if alpha:
        doc["alpha"] = alpha
    if beta:
        doc["beta"] = beta
    doc["viz"] = {
        "nodes": {
            n: {"x": x, "y": y, "w": NODE_W, "h": NODE_H}
            for n, (x, y) in positions.items()
        },
        "linknodes": [
            [l, {"x": x, "y": y, "w": LINK_W, "h": LINK_H}]
            for l, (x, y) in linkpositions.items()
        ],
    }
    return doc


# ── Tier 0 — structural smoke tests (Ch 2, Figure 2.1, p. 35) ─────────────────

MODELS = {}

# T0.1 chain:  A → B → C
MODELS["t0-1-chain"] = model(
    nodes=["A", "B", "C"],
    hedges={"op1": [["A"], ["B"]], "op2": [["B"], ["C"]]},
    positions={"A": (200, 300), "B": (400, 300), "C": (600, 300)},
    linkpositions={"op1": (300, 300), "op2": (500, 300)},
)

# T0.2 split and merge — fan-out from A, multi-source hyperarc into D
MODELS["t0-2-split-merge"] = model(
    nodes=["A", "B", "C", "D"],
    hedges={
        "op1": [[], ["A"]],
        "op2": [["A"], ["B"]],
        "op3": [["A"], ["C"]],
        "op4": [["B", "C"], ["D"]],
    },
    positions={"A": (400, 130), "B": (250, 320), "C": (550, 320), "D": (400, 500)},
    linkpositions={
        "op1": (400, 55),
        "op2": (315, 225),
        "op3": (485, 225),
        "op4": (400, 415),
    },
)

# T0.3 cyclic — ordinary BNs forbid this
MODELS["t0-3-cyclic"] = model(
    nodes=["A", "B"],
    hedges={"op1": [["A"], ["B"]], "op2": [["B"], ["A"]]},
    positions={"A": (300, 300), "B": (560, 300)},
    linkpositions={"op1": (430, 235), "op2": (430, 365)},
)

# T0.4 the conflicted one — two arcs produce B. The "hello world" of PDGs.
MODELS["t0-4-conflicted"] = model(
    nodes=["A", "B"],
    hedges={"op1": [["A"], ["B"]], "op2": [[], ["B"]]},
    positions={"A": (300, 160), "B": (430, 430)},
    linkpositions={"op1": (330, 300), "op2": (560, 300)},
)


# ── Tier 1 — cpds and inconsistency ───────────────────────────────────────────

# C1 — Two coins (Ch 2, Example 2.1, p. 49).
# The smallest genuinely inconsistent PDG. Inconsistency is asymmetric and
# infinite in one direction: `dbl` assigns probability 0 to T, so any belief
# that puts mass on T is infinitely surprising to it, but not vice versa.
MODELS["c1-two-coins"] = model(
    nodes=["X"],
    hedges={"fair": [[], ["X"]], "dbl": [[], ["X"]]},
    cpds={
        "fair": {UNIT: {"H": 0.5, "T": 0.5}},
        "dbl": {UNIT: {"H": 1.0, "T": 0.0}},
    },
    alpha={"fair": 1.0, "dbl": 1.0},
    beta={"fair": 1.0, "dbl": 1.0},
    positions={"X": (430, 400)},
    linkpositions={"fair": (300, 200), "dbl": (560, 200)},
)

# C4 — Grok combines knowledge (Ch 3, Example 3.4, pp. 59–60).
# Two parallel arcs T → C that disagree, but only slightly. The rhetorical
# payload: "not all inconsistencies are equally egregious" — which is why
# OInc is a real number and not a boolean.
MODELS["c4-grok-parallel"] = model(
    nodes=["T", "C"],
    hedges={"p": [["T"], ["C"]], "q": [["T"], ["C"]]},
    cpds={
        # p — the study
        "p": {"t": {"c": 0.80, "~c": 0.20}, "~t": {"c": 0.10, "~c": 0.90}},
        # q — mom. Numerically close to p.
        "q": {"t": {"c": 0.75, "~c": 0.25}, "~t": {"c": 0.15, "~c": 0.85}},
    },
    alpha={"p": 1.0, "q": 1.0},
    beta={"p": 1.0, "q": 1.0},
    positions={"T": (280, 300), "C": (600, 300)},
    linkpositions={"p": (440, 220), "q": (440, 380)},
)

# C7 — Factor graphs are uncalibrated (Ch 3, Example 3.6, p. 89).
# TWO ARCS THAT AGREE. Both carry µ_.7. As hoped, [[M]]*_0+ = µ_.7 — but the
# factor product drifts to µ_.85 (.7²/(.7²+.3²) = .845). The factor graph moves
# even though both sources say the same thing.
_MU7 = {UNIT: {"x1": 0.7, "x2": 0.3}}

MODELS["c7-factorgraph-drift"] = model(
    nodes=["X"],
    hedges={"J1": [[], ["X"]], "J2": [[], ["X"]]},
    cpds={"J1": dict(_MU7), "J2": dict(_MU7)},
    alpha={"J1": 1.0, "J2": 1.0},
    beta={"J1": 1.0, "J2": 1.0},
    positions={"X": (430, 400)},
    linkpositions={"J1": (300, 200), "J2": (560, 200)},
)

# C7' — the fix (p. 90). Merge the qualitative picture so that α_J1 + α_J2 = 1.
# Now [[M']]*_γ = µ_.7 for ALL γ ≥ 0. Load this next to the one above; the
# diff is a single pair of numbers, and it is the whole argument.
MODELS["c7-factorgraph-merged"] = model(
    nodes=["X"],
    hedges={"J1": [[], ["X"]], "J2": [[], ["X"]]},
    cpds={"J1": dict(_MU7), "J2": dict(_MU7)},
    alpha={"J1": 0.5, "J2": 0.5},
    beta={"J1": 1.0, "J2": 1.0},
    positions={"X": (430, 400)},
    linkpositions={"J1": (300, 200), "J2": (560, 200)},
)

# C8 — The coin with a modeled bias (Ch 4, Example 4.1, pp. 121–122).
# Naive maxent over {µ_.5, δ_H} returns .5 — the double-headed coin makes NO
# difference. Model the bias explicitly and the pathological answer becomes
# unreachable:  PDG maxent → 2/3,  min-SDef with α=1 → 3/4.
# Note there is deliberately NO prior on Bias. That is the point.
MODELS["c8-modeled-bias"] = model(
    nodes=["Bias", "Coin"],
    hedges={"p": [["Bias"], ["Coin"]]},
    cpds={
        "p": {
            "F": {"H": 0.5, "T": 0.5},     # fair
            "H2": {"H": 1.0, "T": 0.0},    # double-headed
        }
    },
    alpha={"p": 1.0},
    beta={"p": 1.0},
    positions={"Bias": (430, 180), "Coin": (430, 440)},
    linkpositions={"p": (430, 310)},
)


# ── Catalog metadata ──────────────────────────────────────────────────────────
# Drives the in-app example picker. Kept in this file so a model and the prose
# describing it stay together — a picker entry that has drifted from the model it
# names is worse than no picker at all.
#
# `gamma` / `epsilon` / `iters` are the settings under which each example shows what
# it is meant to show; the UI applies them on load. C8 needs epsilon=1e-3 to dodge the
# opt_joint hard-zero divergence (CLAUDE.md bug 1).
#
# `iters` matters more than it looks. C8 reports Pr(H)=0.711 at 350 iterations and
# 0.750 at 2000 — the first is simply unconverged, but it renders just as
# authoritatively as the second, so an under-iterated demo quietly contradicts the
# dissertation. These are the counts check_examples.py verifies against, so the
# number the UI shows is the number the harness asserts.

# ── C2a — the tanning bed (Ch 3, Example 3.2, p. 56) ──────────────────────────
# Take the smoking BN and add a second cause of cancer. Ex 3.2's point is that a
# BN cannot absorb T without REWRITING p4 over {S, SH, T}, whereas a PDG just
# gains an arc — and the price of gaining it is that C now has two opinions about
# it, which is a genuine inconsistency rather than a modelling error.
#
# The numbers are ours, not the dissertation's: the text gives the structure and
# the argument, not a table. They are chosen so the disagreement is visible but
# not absurd — tanning raises cancer risk on its own, and t4 is the study that
# only ever looked at smoking.
MODELS["c2a-tanning-bed"] = model(
    nodes=["PS", "S", "SH", "T", "C"],
    hedges={
        "p1": [[], ["PS"]],
        "p2": [["PS"], ["S"]],
        "p3": [["PS"], ["SH"]],
        "p4": [["S", "SH"], ["C"]],
        "t1": [[], ["T"]],
        "t4": [["T"], ["C"]],
    },
    cpds={
        "p1": {"\u22c6": {"ps": 0.3, "~ps": 0.7}},
        "p2": {"ps": {"s": 0.4, "~s": 0.6},
               "~ps": {"s": 0.2, "~s": 0.8}},
        "p3": {"ps": {"sh": 0.8, "~sh": 0.2},
               "~ps": {"sh": 0.3, "~sh": 0.7}},
        "p4": {"s, sh": {"c": 0.6, "~c": 0.4},
               "s, ~sh": {"c": 0.4, "~c": 0.6},
               "~s, sh": {"c": 0.1, "~c": 0.9},
               "~s, ~sh": {"c": 0.01, "~c": 0.99}},
        "t1": {"\u22c6": {"t": 0.25, "~t": 0.75}},
        "t4": {"t": {"c": 0.35, "~c": 0.65},
               "~t": {"c": 0.05, "~c": 0.95}},
    },
    positions={"PS": (330, 130), "S": (180, 340), "SH": (480, 340),
               "T": (740, 340), "C": (400, 560)},
    linkpositions={"p1": (330, 60), "p2": (240, 235), "p3": (420, 235),
                   "p4": (330, 460), "t1": (740, 250), "t4": (600, 470)},
)


META: dict[str, dict] = {
    "smoking-cpd": dict(
        title="Smoking (BN as PDG)", source="Ex 3.2, p. 56", tier="Baseline",
        note="A Bayesian network is a PDG with no conflict — Inc ≈ 0. "
             "The consistent control case.",
        gamma=1.0, epsilon=0.0, iters=800),
    "t0-1-chain": dict(
        title="Chain  A → B → C", source="Fig 2.1, p. 35", tier="Tier 0",
        note="Structure only, no cpds. Exercises the renderer, not the math.",
        gamma=1.0, epsilon=0.0, iters=50),
    "t0-2-split-merge": dict(
        title="Split and merge", source="Fig 2.1, p. 35", tier="Tier 0",
        note="Fan-out from A plus a multi-source hyperarc into D.",
        gamma=1.0, epsilon=0.0, iters=50),
    "t0-3-cyclic": dict(
        title="Cyclic  A ⇄ B", source="Fig 2.1, p. 35", tier="Tier 0",
        note="A 2-cycle. Ordinary Bayesian networks forbid this; PDGs do not.",
        gamma=1.0, epsilon=0.0, iters=50),
    "t0-4-conflicted": dict(
        title="Conflicted (two arcs into B)", source="Fig 2.1, p. 35", tier="Tier 0",
        note="The 'hello world' of PDGs: two arcs both determine B.",
        gamma=1.0, epsilon=0.0, iters=50),
    "c1-two-coins": dict(
        title="Two coins", source="Ex 2.1, p. 49", tier="Tier 1",
        note="The smallest genuinely inconsistent PDG, and inconsistency here is "
             "ASYMMETRIC: `dbl` puts 0 on T, so mass on T is infinitely surprising "
             "to it — but not conversely. Optimize → Inc = ∞ (dashed edge, off the end of the colour scale). "
             "Set ε = 1e-3 to recover the true minimum, ln 2 ≈ 0.693.",
        gamma=1.0, epsilon=0.0, iters=2000),
    "c4-grok-parallel": dict(
        title="Grok — parallel arcs disagree slightly", source="Ex 3.4, pp. 59–60",
        tier="Tier 1",
        note="Two arcs T→C that disagree only slightly. Inc ≈ 0.155 — finite, and "
             "far below C1's ∞. 'Not all inconsistencies are equally egregious.'",
        gamma=1.0, epsilon=0.0, iters=800),
    "c7-factorgraph-drift": dict(
        title="Factor graph drift (α = 1 each)", source="Ex 3.6, p. 89", tier="Tier 1",
        note="Two arcs that AGREE — both carry µ_.7. Yet Score (the factor product) "
             "drifts to .845 = .7²/(.7²+.3²), and Optimize to .842. The factor graph "
             "moves even though both sources say exactly the same thing.",
        gamma=1.0, epsilon=0.0, iters=800),
    "c7-factorgraph-merged": dict(
        title="Factor graph fixed (α = .5 each)", source="Ex 3.6, p. 90", tier="Tier 1",
        note="The same model with α_J1 + α_J2 = 1. Press Optimize: Pr(x1) stays at "
             ".700 where the previous example drifts to .842. Score still reads .845 "
             "for both — factor_product weights by β only — but its IDef separates "
             "them (0 here, .62 there). The diff is one pair of numbers.",
        gamma=1.0, epsilon=0.0, iters=800),
    "c2a-tanning-bed": dict(
        title="Tanning bed (BN + one arc)", source="Ex 3.2, p. 56", tier="Tier 1",
        note="The smoking BN plus a second cause of cancer. A BN would have to "
             "rewrite p4 over {S, SH, T}; the PDG just gains an arc — and C now "
             "has two opinions, so Inc leaves zero. Five variables, 32 worlds: the "
             "distribution drawer is the point.",
        gamma=1.0, epsilon=0.0, iters=800),
    "c8-modeled-bias": dict(
        title="Coin with a modeled bias", source="Ex 4.1, pp. 121–122", tier="Tier 1",
        note="Naive maxent over {µ_.5, δ_H} returns .5 — the double-headed coin makes "
             "NO difference. Model the bias explicitly and .5 becomes unreachable: "
             "drag γ from 0 to 1 and watch Pr(H) move 2/3 → 3/4.",
        gamma=1.0, epsilon=1e-3, iters=2000),
}


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, doc in MODELS.items():
        path = os.path.join(OUT_DIR, name + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"wrote {path}")

    # smoking-cpd.json comes from gen_smoking_cpd.py, so a catalog entry may
    # legitimately reference a file this script did not write. Only skip entries
    # with no file at all, and say so rather than emitting a dead picker option.
    catalog = []
    for name, meta in META.items():
        if not os.path.exists(os.path.join(OUT_DIR, name + ".json")):
            print(f"  ! catalog entry {name!r} has no JSON file — skipping")
            continue
        catalog.append({"file": name + ".json", **meta})

    cat_path = os.path.join(OUT_DIR, "catalog.json")
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {cat_path}  ({len(catalog)} entries)")


if __name__ == "__main__":
    main()
