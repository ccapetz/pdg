"""Load every catalog example and check it against the number the dissertation
predicts.

This is the "does the viz actually teach the right thing" harness. Each row
below encodes a claim from the text; if a claim fails, either the JSON is wrong
or my reading of the dissertation is.

Run from the repo root:   python3 viz/check_examples.py
(Must be run as a script from viz/ so that `import pdg` resolves to the
installed package rather than the repo-root pdg.py — see CLAUDE.md.)
"""

import json
import os
import sys

from server import json_to_pdg, _edge_scores, _marginals

EX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples")

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def load(name: str) -> dict:
    with open(os.path.join(EX_DIR, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def report(name: str, gamma: float = 1.0, iters: int = 800, epsilon: float = 0.0):
    """Return (M, factor_product_stats, optimized_stats)."""
    M = json_to_pdg(load(name), epsilon=epsilon)
    out = {"n_vars": len(list(M.atomic_vars)), "n_edges": len(list(M.edges("l")))}

    try:
        mu = M.factor_product()
        out["fp"] = {
            "inc": float(M.Inc(mu)),
            "idef": float(M.IDef(mu)),
            "marginals": _marginals(M, mu),
            "edge_scores": _edge_scores(M, mu),
        }
    except Exception as e:
        out["fp"] = {"error": str(e)}

    try:
        from pdg.alg.torch_opt import opt_joint
        from pdg.dist import RawJointDist as RJD

        mu = opt_joint(M, gamma=gamma, iters=iters)
        if getattr(mu, "_torch", False):
            mu = RJD(mu.data.detach().numpy(), mu.varlist, use_torch=False)
        out["opt"] = {
            "inc": float(M.Inc(mu)),
            "idef": float(M.IDef(mu)),
            "marginals": _marginals(M, mu),
            "edge_scores": _edge_scores(M, mu),
        }
    except Exception as e:
        out["opt"] = {"error": str(e)}

    return out


def check(label: str, actual, expected, tol=0.02):
    if actual is None:
        print(f"  {YELLOW}? {label}: no value{RESET}")
        return
    ok = abs(actual - expected) <= tol
    mark = f"{GREEN}✓{RESET}" if ok else f"{RED}✗{RESET}"
    print(f"  {mark} {label}: {actual:.4f}   (expected ≈ {expected})")


def main() -> None:
    print("\n" + "=" * 72)
    print("TIER 0 — structural smoke tests (Ch 2, Fig 2.1, p. 35)")
    print("=" * 72)
    print(f"{DIM}No cpds, so json_to_pdg adds variables but no edges."
          f" These test the renderer, not the math.{RESET}")
    for n in ["t0-1-chain", "t0-2-split-merge", "t0-3-cyclic", "t0-4-conflicted"]:
        r = report(n, iters=50)
        print(f"  {n:22s} vars={r['n_vars']}  edges={r['n_edges']}")

    print("\n" + "=" * 72)
    print("C1 — two coins (Ch 2, Ex 2.1, p. 49)")
    print("=" * 72)
    r = report("c1-two-coins")
    print(f"  factor product: Inc={r['fp']['inc']:.4f}  X={r['fp']['marginals'].get('X')}")
    print(f"  optimized γ=1 : Inc={r['opt']['inc']:.4f}  X={r['opt']['marginals'].get('X')}")
    print(f"  per-edge      : {r['opt']['edge_scores']}")
    print(f"{DIM}  Claim: genuinely inconsistent, and asymmetric — `dbl` puts 0 on T,"
          f"\n  so mass on T is infinitely surprising to it but not conversely.{RESET}")

    # The minimum is hand-checkable, so assert it rather than eyeballing it:
    #   OInc(µ) = KL(µ‖µ_.5) + KL(µ‖δ_H);  the second term is ∞ unless µ = δ_H,
    #   so the minimizer is δ_H and  Inc* = KL(δ_H‖µ_.5) = ln 2 = 0.6931.
    # The factor product already lands there. The OPTIMIZER does not: at ε=0 it
    # converges to δ_T — the opposite corner, and the worst point in the simplex.
    # Same hard-zero divergence as C8 (see CLAUDE.md bug 1), which is easy to miss
    # here because "Inc=inf" looks like a faithful report of an inconsistent model.
    import math

    check("factor product Inc = ln 2", r["fp"]["inc"], round(math.log(2), 4), tol=0.01)
    if not math.isinf(r["opt"]["inc"]):
        print(f"  {YELLOW}? optimizer no longer diverges at ε=0 —"
              f" upstream bug may be fixed; revisit the ε workaround{RESET}")
    else:
        print(f"{DIM}  (ε=0 optimizer diverges to δ_T, Inc=inf — expected, bug 1){RESET}")
    rs = report("c1-two-coins", iters=2000, epsilon=1e-3)
    # Smoothing costs ε/2 on the `dbl` edge, so the target is ln2 + ~0.0005.
    check("ε=1e-3 optimized Inc → ln 2", rs["opt"]["inc"], round(math.log(2), 4), tol=0.01)
    check("ε=1e-3 optimized Pr(H) → 1",
          rs["opt"]["marginals"].get("X", {}).get("H"), 1.0, tol=0.01)

    print("\n" + "=" * 72)
    print("C4 — Grok parallel arcs (Ch 3, Ex 3.4, pp. 59–60)")
    print("=" * 72)
    r = report("c4-grok-parallel")
    print(f"  factor product: Inc={r['fp']['inc']:.4f}")
    print(f"  optimized γ=1 : Inc={r['opt']['inc']:.4f}")
    print(f"  per-edge      : {r['opt']['edge_scores']}")
    print(f"{DIM}  Claim (p. 60): 'not all inconsistencies are equally egregious.'"
          f"\n  p ≈ q, so Inc should be small but strictly positive.{RESET}")
    # The claim is comparative, not absolute: C4 must be finite and far below
    # C1, which is the "egregious" case.
    c1 = report("c1-two-coins")["opt"]["inc"]
    inc = r["opt"]["inc"]
    ok = 0 < inc < 0.25 and inc < c1
    mark = GREEN + "\u2713" + RESET if ok else RED + "\u2717" + RESET
    print(f"  {mark} finite and far below C1:  C4={inc:.4f}  vs  C1={c1}")

    print("\n" + "=" * 72)
    print("C7 — factor graphs are uncalibrated (Ch 3, Ex 3.6, pp. 89–90)")
    print("=" * 72)
    print(f"{DIM}  Two arcs that AGREE, both carrying µ_.7.{RESET}")
    r = report("c7-factorgraph-drift")
    fp_x1 = r["fp"]["marginals"].get("X", {}).get("x1")
    print(f"  α=1 each, factor product (θ:=β):")
    check("Pr(x1) drifts to .7²/(.7²+.3²)", fp_x1, 0.845, tol=0.01)
    op_x1 = r["opt"]["marginals"].get("X", {}).get("x1")
    print(f"  α=1 each, optimized γ=1:")
    check("Pr(x1)", op_x1, 0.845, tol=0.03)

    r2 = report("c7-factorgraph-merged")
    op2_x1 = r2["opt"]["marginals"].get("X", {}).get("x1")
    print(f"  α=.5 each (merged, α_J1+α_J2=1), optimized γ=1:")
    check("Pr(x1) stays at .7", op2_x1, 0.70, tol=0.03)
    print(f"{DIM}  The whole argument is the diff between these two files:"
          f" one pair of numbers.{RESET}")

    print("\n" + "=" * 72)
    print("C8 — the coin with a modeled bias (Ch 4, Ex 4.1, pp. 121–122)")
    print("=" * 72)
    print(f"{DIM}  With eps=0 the optimizer diverges to an Inc=inf corner"
          f" (upstream bug).\n  Using eps=1e-3 to keep it on the simplex"
          f" interior.{RESET}")
    for g, expected in [(0.0, 2 / 3), (1.0, 3 / 4)]:
        rr = report("c8-modeled-bias", gamma=g, iters=2000, epsilon=1e-3)
        h = rr["opt"]["marginals"].get("Coin", {}).get("H")
        bias = rr["opt"]["marginals"].get("Bias")
        print(f"  γ={g}:  Bias={bias}")
        check(f"Pr(H) at γ={g}", h, round(expected, 4), tol=0.03)
    print(f"{DIM}  Claim: naive maxent over {{µ_.5, δ_H}} returns .5 — the"
          f" double-headed coin\n  makes NO difference. Modelling the bias"
          f" explicitly makes .5 unreachable.{RESET}")

    print()


if __name__ == "__main__":
    main()
