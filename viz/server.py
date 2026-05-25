import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

from pdg import PDG
from pdg.rv import Variable, Unit
from pdg.dist import CPT
from pdg.alg.torch_opt import opt_joint

try:
    from pdg.alg.interior_pt import cvx_opt_joint
    _cvxpy_available = True
except ImportError:
    _cvxpy_available = False

VIZ_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8080

_executor = ThreadPoolExecutor(max_workers=2)


# ── PDG reconstruction ────────────────────────────────────────────────────────

def _infer_domains(hedges: dict, cpds: dict) -> dict[str, list]:
    """Infer the ordered value domain for each variable from CPD data."""
    domains: dict[str, list] = {}

    def _add(name, states):
        if name not in domains:
            domains[name] = list(states)

    for label, (srcs, tgts) in hedges.items():
        if label not in cpds:
            continue
        cpd = cpds[label]
        first_row = next(iter(cpd.values()))

        for tgt in tgts:
            _add(tgt, first_row.keys())

        if len(srcs) == 0:
            pass  # Unit source — no variable to infer
        elif len(srcs) == 1:
            _add(srcs[0], cpd.keys())
        else:
            # Multi-source: collect ordered states per position from combo keys
            per_var: list[list] = [[] for _ in srcs]
            for combo in cpd.keys():
                parts = [p.strip() for p in combo.split(",")]
                for i, state in enumerate(parts):
                    if state not in per_var[i]:
                        per_var[i].append(state)
            for src, states in zip(srcs, per_var):
                _add(src, states)

    return domains


def json_to_pdg(data: dict) -> PDG:
    hedges: dict = data["hedges"]   # label -> [srcs, tgts]
    cpds: dict = data.get("cpds", {})
    node_names: list[str] = data["nodes"]

    domains = _infer_domains(hedges, cpds)

    # Build Variable objects
    var_objs: dict[str, Variable] = {}
    for name in node_names:
        if name in domains:
            states = domains[name]
            var_objs[name] = Variable(states, name=name, default_value=states[0])
        else:
            s = name.lower()
            var_objs[name] = Variable([s, "~" + s], name=name, default_value=s)

    M = PDG()
    for v in var_objs.values():
        M += v

    for label, (srcs, tgts) in hedges.items():
        if len(tgts) != 1:
            continue  # only single-target edges supported
        if label not in cpds:
            continue  # skip structural edges without CPD

        tgt_var = var_objs[tgts[0]]
        cpd = cpds[label]

        if len(srcs) == 0:
            src_var = Unit
            data_dict = cpd
        elif len(srcs) == 1:
            src_var = var_objs[srcs[0]]
            data_dict = cpd
        else:
            src_var = Variable.product(*[var_objs[s] for s in srcs])
            # Convert "s, sh" string keys to ('s', 'sh') tuples
            data_dict = {
                tuple(p.strip() for p in k.split(",")): v
                for k, v in cpd.items()
            }

        M += (label, CPT.from_ddict(src_var, tgt_var, data_dict))

    return M


def _edge_scores(M: PDG, mu) -> dict[str, float]:
    import numpy as np
    from pdg.dist import z_mult, zz1_div

    Pr = lambda *q: mu.conditional_marginal(q, query_mode="ndarray")
    scores = {}
    for l, X, Y, cpd, beta in M.edges("lXYPβ"):
        # Skip structural projection edges (Y is an atom of X):
        # these are always deterministically consistent → Inc = 0.
        if any(a.name == Y.name for a in X.atoms):
            continue
        if cpd is None:
            scores[l] = 0.0
            continue
        try:
            cpd_arr = np.array(cpd.broadcast_to(list((Y & X).atoms)))
            claims = np.isfinite(cpd_arr)
            joint = Pr(Y, X)
            cond = Pr(Y | X)
            edgeinc = float(beta * z_mult(
                joint, np.ma.where(claims, np.ma.log(zz1_div(cond, cpd_arr)), 0)
            ).filled(np.inf).sum())
            scores[l] = edgeinc
        except Exception:
            scores[l] = 0.0

    return scores


# ── Request / response models ─────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    hypergraph: dict
    gamma: float = 1.0


class OptimizeRequest(BaseModel):
    hypergraph: dict
    gamma: float = 1.0
    algorithm: str = "torch"   # "torch" | "cvxpy"
    iters: int = 350


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="PDG API")


@app.get("/")
def root():
    return FileResponse(os.path.join(VIZ_DIR, "interface.htm"))


@app.post("/api/score")
def api_score(req: ScoreRequest):
    """Compute Inc/IDef for the factor-product distribution."""
    try:
        M = json_to_pdg(req.hypergraph)
        mu = M.factor_product()
        return {
            "inc": float(M.Inc(mu)),
            "idef": float(M.IDef(mu)),
            "edge_scores": _edge_scores(M, mu),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/optimize")
async def api_optimize(req: OptimizeRequest):
    """Find the inconsistency-minimizing distribution."""
    if req.algorithm == "cvxpy" and not _cvxpy_available:
        raise HTTPException(status_code=400, detail="cvxpy is not installed")

    try:
        M = json_to_pdg(req.hypergraph)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDG construction failed: {e}")

    def run():
        if req.algorithm == "torch":
            return opt_joint(M, gamma=req.gamma, iters=req.iters)
        else:
            return cvx_opt_joint(M)

    try:
        loop = asyncio.get_event_loop()
        mu = await loop.run_in_executor(_executor, run)
        # Convert torch distribution to numpy so that M.Inc/IDef don't hit
        # the permute bug in conditional_marginal for structural π-edges.
        if getattr(mu, "_torch", False):
            from pdg.dist import RawJointDist as RJD
            mu = RJD(mu.data.detach().numpy(), mu.varlist, use_torch=False)
        return {
            "inc": float(M.Inc(mu)),
            "idef": float(M.IDef(mu)),
            "edge_scores": _edge_scores(M, mu),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Static files — must be mounted last so API routes take priority
app.mount("/", StaticFiles(directory=VIZ_DIR), name="static")


if __name__ == "__main__":
    print(f"PDG viz  →  http://localhost:{PORT}/")
    print(f"API docs →  http://localhost:{PORT}/docs")
    print("Press Ctrl+C to stop.\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
