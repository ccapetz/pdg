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
> startup model over HTTP, and Torch Solve calls back into Python. You need the server.

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
   dependence) and **β** (in the CPD itself). **Click a variable** instead and you get
   its values plus the arcs into and out of it, each one a shortcut to the full arc view.
3. **Torch Solve** runs a gradient minimizer to find beliefs that reconcile the model.
   It reports `Inc` and `IDef` and recolours each arc by its contribution. An arc whose
   CPD rules out something believed has infinite inconsistency, and is drawn in a
   deeper red **and dashed**.
4. **Drag γ** to trade off structural against observational fit; after a solve, releasing
   the slider re-runs Torch. The ε selector smooths CPDs before either computation.
5. **Read the distribution** in the drawer along the bottom — see below.

α and β are also drawn, not just editable: **β sets arc thickness, α sets opacity**, so a
*proper* PDG (β ≫ α) looks like what it is — thick, faint arcs.

### Authoring

You can build a model from nothing:

- **Double-click empty canvas** to make an auto-named node, then click its inspector
  title to rename it. Drag a node to move it;
  **Shift-drag from a node** to draw an arc. `t` pulls an arc from the current selection
  (including multiple source nodes). Drag empty canvas to box-select, Cmd/Ctrl+A selects
  everything, Backspace/Delete removes the selection, and Cmd/Ctrl+Z undoes the most
  recent graph edit. Text fields keep their normal typing undo.
- **A new arc arrives with an empty CPD of the right shape**, rows and columns already
  labelled by the variables' values, so it is immediately editable. Unfinished rows are
  flagged red, and an **Autofill** button samples Dirichlet(1) — uniform over the simplex
  — into whatever is still blank, leaving numbers you typed alone.
- **Variable domains are editable** in the variable inspector, one field per value.
  Renaming a value rewrites it in every CPD that mentions it; adding or removing one
  reshapes those CPDs, keeping every cell that still has a home and blanking the rest.
- **Click the inspector's title** to rename a variable or an arc.
- A **warning banner** appears bottom left whenever something is unfinished. It is a
  button: each click steps to the next offender and opens it.

`Save`/`Load` round-trip JSON. Press **Help** (top left) for the full key map.

### The distribution drawer *(new, work in progress)*

Torch Solve opens a drawer along the bottom with three views of its joint distribution:

- **Marginals**, one chip per value. **Click a value to condition on it** and the column
  re-reads as `P( · | PS = ps )`.
- **The most likely worlds**, as sorted bars. Always the top 20, with a line for what is
  left over, so the chart stays the same size however large the model gets.
- **Pairwise mutual information**, in bits — what the joint knows that the marginals throw
  away. Sized by the number of variables rather than by the product of their domains.

The joint itself is never sent to the browser; these are derived from it in `server.py`.
Conditioning currently re-reads the marginals column only — the other two still describe
the unconditioned joint.

Open **Advanced · baseline / compare** in the drawer to compute the factor-product
baseline. It constructs a distribution from β-weighted factors rather than minimizing
the PDG objective; γ does not affect it, but ε does. The comparison lists Inc in nats
and IDef in bits for both methods, and lets you inspect either distribution.

### The examples

| Example | Source | What it shows |
|---|---|---|
| Smoking (BN as PDG) | Ex 3.2 | A Bayesian network has no conflict — `Inc ≈ 6e-18`. The control case. |
| Chain / split-merge / cyclic / conflicted | Fig 2.1 | Topology only. The cyclic one is **illegal in a BN**. |
| Two coins | Ex 2.1 | Smallest genuinely inconsistent PDG. `Inc` is **asymmetric and infinite one way**. |
| Grok (parallel arcs) | Ex 3.4 | Two arcs that disagree *slightly*: `Inc = 0.155`, finite. Not all inconsistencies are equally bad. |
| Factor graph: drift vs merged | Ex 3.6 | Identical except for α. Optimize gives **0.842 vs 0.700**. The difference between these two files is the entire argument. |
| Modeled bias | Ex 4.1 | Modelling the coin's bias explicitly → **2/3 at γ=0, 3/4 at γ=1**. |
| Tanning bed | Ex 3.2 | The smoking BN plus a second cause of cancer. A BN would have to rewrite `p4` over `{S, SH, T}`; the PDG just gains an arc — and `Inc` leaves zero. |

`make check` verifies the dissertation examples against the numbers the text predicts.
(The tanning bed's CPDs are ours — Ex 3.2 gives the structure and the argument, not a
table — so it is not among the pinned checks.)

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
  gen_catalog_examples.py   writes examples/ and catalog.json
  check_examples.py         verifies them against the dissertation
```

**The Python library is deliberately untouched.** It is the only part whose correctness
can't be checked by looking at it: if `Inc` is subtly wrong, every conclusion downstream is
silently poisoned. Where the backbone misbehaves, `viz/server.py` routes around it and the
bug is documented at the call site rather than patched.

### Known limitations

- **`cvxpy` is optional and not installed by default.** The convex solver
  (`/api/optimize?algorithm=cvxpy`) returns HTTP 400 without it; `pip install cvxpy` or
  `uv run --extra web --extra cvx …` to enable it. The default torch solver needs nothing extra.
- **The optimizer diverges on exact zeros in a CPD.** The ε selector smooths them as a
  workaround. It is a bug workaround, not a modelling knob — which is why it is a discrete
  selector rather than a slider.
- Multi-target hyperarcs are not in the JSON schema, and variable domains have no field of
  their own — they are inferred from CPD keys, which means a variable with no arcs has no
  domain to save.
- **The distribution drawer is new and unfinished.** Conditioning affects the marginals
  column only; the worlds chart and the mutual-information matrix still describe the
  unconditioned joint.
- An arc whose CPD is unfinished is left out of Torch Solve and the baseline — the panel names which
  ones — rather than being guessed at.

---

## Citing the underlying work

The library and the theory are Oliver Richardson's — AAAI 2021, AISTATS 2022, UAI 2023.
Start with the AAAI paper on [arXiv](https://arxiv.org/abs/2012.10800), and see the
[project page](https://orichardson.github.io/pdg/).
