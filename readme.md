# Probabilistic Dependency Graphs — library + visual editor

Probabilistic Dependency Graphs (PDGs) are a class of graphical model that can represent
**combinations of inconsistent beliefs**. They generalize Bayesian Networks and factor
graphs, and their measure of inconsistency is useful in its own right: many
information-theoretic loss functions and statistical distances arise naturally as the
inconsistency of an appropriate PDG.

> **This is a fork** of [orichardson/pdg](https://github.com/orichardson/pdg) by Oliver
> Richardson. The Python library is his and is kept byte-identical to upstream. What this
> fork adds is **`viz/`** — an interactive editor for building PDGs and watching their
> inconsistency respond to what you change.

---

## Quick start

Requires [uv](https://docs.astral.sh/uv/). Everything else — including the Python
interpreter — is provisioned for you.

```bash
git clone https://github.com/ccapetz/pdg && cd pdg
make viz
```

Then open **http://localhost:8080**.

<details>
<summary>Without <code>make</code>, or without <code>uv</code></summary>

```bash
uv run --extra web viz/server.py          # uv, no make

# or plain pip
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[web]"
python3 viz/server.py
```

The `web` extra is what installs FastAPI and uvicorn. Note that the separate `viz` extra
is *not* this one — it installs matplotlib for `distviz.py`, an unrelated plotting module.
</details>

> ⚠ **Opening `interface.htm` as a `file://` URL does not work.** The page fetches its
> startup model over HTTP, and Score/Optimize call back into Python. You need the server.

The first run downloads PyTorch, so expect it to take a few minutes. After that, startup
is immediate.

---

## What you can do with it

The tool opens on a worked example. The loop is:

1. **Pick a model** from the dropdown at the top. Each entry cites the dissertation
   example it reproduces and loads with the γ, ε and iteration count under which that
   example shows what it is meant to show.
2. **Click an arc** to open the inspector: sources, targets, an editable CPD table with
   row-sum validation, and the arc's two confidences — **α** (in the functional
   dependence) and **β** (in the CPD itself).
3. **Score** computes inconsistency in closed form. You get `Inc`, `IDef`, per-variable
   marginals, and each arc recoloured blue→red by how much *it* contributes. Arcs with
   infinite inconsistency go magenta and dashed.
4. **Optimize** runs a gradient minimizer to find the beliefs that best reconcile the
   model (~0.4 s).
5. **Drag γ** to trade off structural against observational fit; the last action re-runs
   automatically.

α and β are also drawn, not just editable: **β sets arc thickness, α sets opacity**, so a
*proper* PDG (β ≫ α) looks like what it is — thick, faint arcs.

You can also author from scratch: right-click for a node, `d` for draw mode, `t` to pull an
arc from a selection, `x` to delete. `Save`/`Load` round-trip JSON. Press **Help** (top
left) for the full key map.

### The examples

| Example | Source | What it shows |
|---|---|---|
| Smoking (BN as PDG) | Ex 3.2 | A Bayesian network has no conflict — `Inc ≈ 6e-18`. The control case. |
| Chain / split-merge / cyclic / conflicted | Fig 2.1 | Topology only. The cyclic one is **illegal in a BN**. |
| Two coins | Ex 2.1 | Smallest genuinely inconsistent PDG. `Inc` is **asymmetric and infinite one way**. |
| Grok (parallel arcs) | Ex 3.4 | Two arcs that disagree *slightly*: `Inc = 0.155`, finite. Not all inconsistencies are equally bad. |
| Factor graph: drift vs merged | Ex 3.6 | Identical except for α. Optimize gives **0.842 vs 0.700**. The difference between these two files is the entire argument. |
| Modeled bias | Ex 4.1 | Modelling the coin's bias explicitly → **2/3 at γ=0, 3/4 at γ=1**. |

`make check` verifies every one of them against the number the dissertation predicts.

---

## Repository layout

```
pdg.py  dist.py  rv.py  fg.py  qdg.py  store.py     core library (upstream, unmodified)
alg/    gen/  lib/  sim/  util/  examples/          algorithms & models (upstream)
viz/                                                the editor (this fork)
  server.py         FastAPI bridge: /api/score, /api/optimize
  interface.htm     UI shell
  pdg-view.js       view model, rendering, force simulation
  pdgviz.js         canvas, input handling, inspector, controls
  examples/         model JSON + catalog.json (generated — edit the generator)
dissertation/                                       structured reference notes
```

**The Python library is deliberately untouched.** It is the only part whose correctness
can't be checked by looking at it: if `Inc` is subtly wrong, every conclusion downstream is
silently poisoned. Where the backbone misbehaves, `viz/server.py` routes around it and the
bug is documented rather than patched. See `CLAUDE.md` for the specifics.

### Known limitations

- **`cvxpy` is optional and not installed by default.** The convex solver
  (`/api/optimize?algorithm=cvxpy`) returns HTTP 400 without it; `pip install cvxpy` or
  `uv run --extra web --extra cvx …` to enable it. The default torch solver needs nothing extra.
- **The optimizer diverges on exact zeros in a CPD.** The ε selector smooths them as a
  workaround. It is a bug workaround, not a modelling knob — which is why it is a discrete
  selector rather than a slider.
- Multi-target hyperarcs and explicit variable domains are not yet in the JSON schema;
  domains are inferred from CPD keys.

---

## Citing the underlying work

The library and the theory are Oliver Richardson's — AAAI 2021, AISTATS 2022, UAI 2023.
Start with the AAAI paper on [arXiv](https://arxiv.org/abs/2012.10800), and see the
[project page](https://orichardson.github.io/pdg/).
