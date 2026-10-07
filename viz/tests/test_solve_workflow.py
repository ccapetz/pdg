"""User-visible contract for the primary solve and advanced baseline workflow."""

from pathlib import Path
import unittest


VIZ = Path(__file__).resolve().parents[1]
HTML = (VIZ / "interface.htm").read_text()
JS = (VIZ / "pdgviz.js").read_text()


class SolveWorkflowTest(unittest.TestCase):
    def test_toolbar_has_one_primary_solve_action(self):
        toolbar = HTML.split('<div class="toolbar"', 1)[1].split('</div>\n\t\t', 1)[0]
        self.assertIn('id="optimize-button">Torch Solve</button>', toolbar)
        self.assertNotIn('id="score-button"', toolbar)

    def test_baseline_is_disclosed_in_distribution_drawer(self):
        drawer = HTML.split('<section id="joint-drawer"', 1)[1].split('</section>', 1)[0]
        self.assertRegex(drawer, r'<details[^>]+id="baseline-compare"')
        self.assertIn('id="baseline-button"', drawer)
        self.assertIn('id="baseline-inc"', drawer)
        self.assertIn('id="baseline-idef"', drawer)
        self.assertIn('id="show-baseline"', drawer)
        self.assertIn('id="show-torch"', drawer)

    def test_torch_is_primary_and_baseline_retains_score_endpoint(self):
        self.assertRegex(JS, r"#optimize-button['\"]\)\.click\(async function")
        self.assertIn("fetch('/api/optimize'", JS)
        self.assertIn("fetch('/api/score'", JS)
        self.assertRegex(JS, r"#baseline-button['\"]\)\.click\(async function")
        self.assertIn('Torch solve · γ=', JS)
        self.assertIn("'Factor-product baseline", JS)

    def test_only_torch_reruns_for_gamma_and_both_methods_receive_epsilon(self):
        self.assertIn("if (hasSolved) $('#optimize-button').click()", JS)
        baseline = JS.split("$('#baseline-button').click", 1)[1].split("$('#optimize-button').click", 1)[0]
        self.assertIn('hypergraph: payload.hypergraph, epsilon', baseline)
        self.assertNotIn('gamma: getGamma()', baseline)
        self.assertIn('gamma: getGamma(), epsilon: getEpsilon()', JS)


if __name__ == "__main__":
    unittest.main()
