//A web-page opened via the file:// protocol cannot use import / export.
// import defaultExport from '/link-modified.js';

console.log("pdgvz.js");

const INSPECTOR_WIDTH = 280;

function renderMathLabel(text) {
	if (!text) return '';
	const hasMath = text.includes('$') || /\\[a-zA-Z]/.test(text);
	if (hasMath && typeof katex !== 'undefined') {
		const math = text.replace(/^\$+/, '').replace(/\$+$/, '');
		try { return katex.renderToString(math, { throwOnError: false, displayMode: false }); }
		catch(e) { /* fall through */ }
	}
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rowSum(cpd, combo) {
	return Object.values(cpd[combo]).reduce((s, v) => s + (v || 0), 0);
}

// α/β round-trip through JSON as either numbers or the strings "inf"/"∞", so the
// inspector has to speak both. Returns undefined for blank input, which the caller
// treats as "unset" (delete the property) rather than "set to 1" — the JSON omits
// absent weights entirely so the server falls through to the PDG default, and
// collapsing that distinction would silently rewrite every file the user opens.
function parseWeight(raw) {
	const s = String(raw).trim();
	if (s === '') return undefined;
	if (/^(inf|infinity|∞)$/i.test(s)) return 'inf';
	const n = Number(s);
	// Reject negatives: α and β are confidences. Returning null lets the caller
	// distinguish "leave it alone, the input was garbage" from "clear it".
	return (Number.isFinite(n) && n >= 0) ? n : null;
}

function formatWeight(v) {
	if (v === undefined || v === null) return '';
	if (v === 'inf' || v === '∞' || v === Infinity) return 'inf';
	return String(v);
}

// A proper PDG has β ≫ α. Saying so at the point of editing is the cheapest way to
// convey what these two numbers are for; the geometric encoding (thickness = β,
// opacity = α) shows the comparison but never names it.
function weightHint(link) {
	const a = parseWeight(formatWeight(link.alpha));
	const b = parseWeight(formatWeight(link.beta));
	const av = a === undefined ? 1 : (a === 'inf' ? Infinity : a);
	const bv = b === undefined ? 1 : (b === 'inf' ? Infinity : b);
	if (typeof av !== 'number' || typeof bv !== 'number') return '';
	if (bv > av) return 'β > α — proper (observation outweighs structure)';
	if (bv === av) return 'β = α — structure and observation weighted equally';
	return 'β < α — structure outweighs the cpd';
}

function buildCpdTable(link) {
	const cpd = link.cpd;
	const srcCombos = Object.keys(cpd);
	if (!srcCombos.length) return '<span class="no-cpd">Empty CPD</span>';
	const tgtStates = Object.keys(cpd[srcCombos[0]]);

	let html = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0 cpd-table"><thead><tr>';
	if (link.srcs.length) html += `<th class="text-muted">${link.srcs.join(', ')}</th>`;
	for (const t of tgtStates) html += `<th class="text-center">${t}</th>`;
	html += '</tr></thead><tbody>';
	for (const combo of srcCombos) {
		const invalid = Math.abs(rowSum(cpd, combo) - 1) > 0.001;
		html += `<tr${invalid ? ' class="cpd-row-invalid"' : ''}>`;
		if (link.srcs.length) html += `<td class="text-muted small">${combo}</td>`;
		for (const t of tgtStates) {
			const p = cpd[combo][t];
			const val = typeof p === 'number' ? p.toFixed(4) : p;
			html += `<td><input type="number" class="cpd-input" min="0" max="1" step="0.0001" value="${val}" data-combo="${combo}" data-tgt="${t}"></td>`;
		}
		html += '</tr>';
	}
	html += '</tbody></table></div>';
	return html;
}

// `onEdit` is invoked after any \u03b1/\u03b2 change so the caller can repaint \u2014 \u03b1 and \u03b2 are
// rendered geometrically (opacity and thickness), so an edit that does not repaint
// leaves the picture contradicting the panel. Passed in rather than referenced
// directly because redraw() lives inside the page's jQuery-ready closure.
function showEdgeInspector(link, onEdit) {
	const panel = document.getElementById('inspector');
	panel.querySelector('.inspector-empty').style.display = 'none';
	const content = panel.querySelector('.inspector-content');
	content.style.display = '';

	panel.querySelector('.inspector-label').innerHTML = renderMathLabel(link.label);
	panel.querySelector('.inspector-srcs').textContent =
		link.srcs.length ? link.srcs.join(', ') : '\u2205 (prior)';
	panel.querySelector('.inspector-tgts').textContent = link.tgts.join(', ');

	const hintEl = panel.querySelector('.inspector-weight-hint');
	const alphaEl = document.getElementById('inspector-alpha');
	const betaEl  = document.getElementById('inspector-beta');
	alphaEl.value = formatWeight(link.alpha);
	betaEl.value  = formatWeight(link.beta);
	hintEl.textContent = weightHint(link);

	// Rebind per show: these inputs are reused across edges, so a listener that
	// closed over the previous link would keep writing to it. replaceWith(clone)
	// is the least fiddly way to drop every prior listener.
	for (const [el, key] of [[alphaEl, 'alpha'], [betaEl, 'beta']]) {
		const fresh = el.cloneNode(true);
		el.replaceWith(fresh);
		fresh.addEventListener('change', () => {
			const parsed = parseWeight(fresh.value);
			if (parsed === null) {            // unparseable \u2014 restore, do not guess
				fresh.value = formatWeight(link[key]);
				return;
			}
			if (parsed === undefined) delete link[key];   // back to the PDG default
			else link[key] = parsed;
			fresh.value = formatWeight(link[key]);
			hintEl.textContent = weightHint(link);
			if (onEdit) onEdit();
		});
	}

	const cpdEl = panel.querySelector('.inspector-cpd');
	cpdEl.innerHTML = link.cpd
		? buildCpdTable(link)
		: '<span class="no-cpd">No CPD loaded</span>';

	if (link.cpd) {
		cpdEl.querySelectorAll('.cpd-input').forEach(input => {
			input.addEventListener('change', () => {
				const combo = input.dataset.combo;
				const tgt = input.dataset.tgt;
				let val = parseFloat(input.value);
				if (isNaN(val)) val = 0;
				val = Math.max(0, Math.min(1, val));
				input.value = val.toFixed(4);
				link.cpd[combo][tgt] = val;
				const row = input.closest('tr');
				row.classList.toggle('cpd-row-invalid', Math.abs(rowSum(link.cpd, combo) - 1) > 0.001);
			});
		});
	}
}

function hideInspector() {
	const panel = document.getElementById('inspector');
	panel.querySelector('.inspector-empty').style.display = '';
	panel.querySelector('.inspector-content').style.display = 'none';
}

$(function() {
	// resize to full screen
	let canvas = document.getElementById("canvas"),
		svg = d3.select("#svg");
	let context = canvas.getContext("2d");

	// Declared up front rather than sprung into existence by initPDG's assignment.
	// As implicit globals these could not be *read* before the first initPDG call
	// (a bare `pdg` reference throws ReferenceError, not undefined), which made
	// "load into the existing view, or build one if there isn't one yet" impossible
	// to express. They sit above resizeCanvas because resizeCanvas runs immediately
	// at line ~104 and touches `pdgs`; a `let` below that point would be in the
	// temporal dead zone, and `typeof` does NOT guard against TDZ the way it does
	// for undeclared names. Nothing outside this closure touches them.
	let pdg = null;
	let pdgs = [];

	function resizeCanvas() {
		// Assigning canvas.width CLEARS the canvas, so every view must redraw.
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		// The old guard here tested `typeof simulation`, but `simulation` is local to
		// PDGView and does not exist in this scope — so it was always "undefined" and
		// this never ran, leaving the canvas blank after a resize until some unrelated
		// event repainted it. That was masked while the force simulation kept ticking
		// after load; now that pinned layouts stop the simulation outright, nothing
		// would repaint at all and a resize would blank the graph for good.
		//
		// tick() recomputes link paths and repaints without reheating the simulation,
		// which is what we want: a resize is not a reason to relayout a pinned figure.
		for (const view of pdgs) view.tick();
	}
	window.addEventListener('resize', resizeCanvas, false);
	resizeCanvas()

	let mode = $('#drag-mode-toolbar button.active').attr('data-mode');

	$('#drag-mode-toolbar button').on('click', function() {
		$('#drag-mode-toolbar button').removeClass("active");
		$(this).addClass('active');
		mode = $(this).attr('data-mode');
	});


	let mouse = { w : 0, h: 0 };

	function initPDG(hypergraph) {
		pdg = PDGView(hypergraph, mouse);
		pdgs = [pdg];
		pdg.repaint_via(redraw);
		hideScoreReadout();
	}

	// ── γ / ε controls ───────────────────────────────────────────────────────
	// `lastScoreAction` is what makes γ *live*: once you have run Score or
	// Optimize, moving the slider re-runs the same computation. That is what
	// turns C7/C8 from static files into the demo they are meant to be — drag γ
	// from 0 to 1 and watch Pr(H) move 2/3 → 3/4 (Ex 4.1).
	let lastScoreAction = null;

	// Iteration count for /api/optimize. Per-example, because convergence is a
	// property of the model: C8 reads Pr(H)=0.711 at 350 iterations and 0.750 at
	// 2000, and an unconverged number is displayed just as confidently as a
	// converged one. The catalog carries the counts check_examples.py asserts.
	const DEFAULT_ITERS = 800;
	let currentIters = DEFAULT_ITERS;

	function getGamma()   { return parseFloat(document.getElementById('gamma-slider').value); }
	function getEpsilon() { return parseFloat(document.getElementById('epsilon-select').value); }

	function setGamma(g) {
		document.getElementById('gamma-slider').value = String(g);
		document.getElementById('gamma-val').textContent = Number(g).toFixed(2);
	}

	function setEpsilon(eps) {
		const sel = document.getElementById('epsilon-select');
		const opt = [...sel.options].find(o => parseFloat(o.value) === eps);
		if (opt) { sel.value = opt.value; return; }
		// An example requesting an ε with no matching option is a catalog bug. Adding
		// the option surfaces it; silently keeping the old ε would score the model
		// under settings it was not meant to be scored under.
		const o = document.createElement('option');
		o.value = String(eps);
		o.textContent = String(eps);
		sel.appendChild(o);
		sel.value = o.value;
	}

	function hideScoreReadout() {
		document.getElementById('score-readout').style.display = 'none';
		document.getElementById('score-marginals').innerHTML = '';
	}

	function rerunLastScore() {
		if (lastScoreAction === 'score')         $('#score-button').click();
		else if (lastScoreAction === 'optimize') $('#optimize-button').click();
	}

	$('#gamma-slider').on('input', function () {
		document.getElementById('gamma-val').textContent = Number(this.value).toFixed(2);
	});
	// Re-run on `change` (pointer release), not `input` — optimize takes ~0.4 s, so
	// firing per pixel of drag would queue dozens of solves for one gesture.
	$('#gamma-slider').on('change', rerunLastScore);
	$('#epsilon-select').on('change', rerunLastScore);

	// ── Example catalog ──────────────────────────────────────────────────────
	// examples/catalog.json is generated by gen_catalog_examples.py alongside the
	// models themselves, so a picker entry cannot drift from the model it names.
	// It is a static file, not an endpoint — one less moving part.
	let catalogEntries = [];

	function showExampleMeta(entry) {
		document.getElementById('example-source').textContent = entry ? entry.source : '';
		document.getElementById('example-note').textContent   = entry ? entry.note   : '';
	}

	async function loadExample(file) {
		const entry = catalogEntries.find(e => e.file === file) || null;
		const res = await fetch('examples/' + file);
		if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
		const ob = await res.json();

		if (pdg) pdg.load(ob); else initPDG(ob);

		// Each example ships the γ/ε under which it shows what it is meant to show
		// (C8 needs ε=1e-3 to dodge the opt_joint hard-zero divergence), so applying
		// them is part of loading the example, not a separate step for the user.
		if (entry && typeof entry.gamma   === 'number') setGamma(entry.gamma);
		if (entry && typeof entry.epsilon === 'number') setEpsilon(entry.epsilon);
		currentIters = (entry && typeof entry.iters === 'number') ? entry.iters : DEFAULT_ITERS;

		showExampleMeta(entry);
		hideScoreReadout();
		lastScoreAction = null;
	}

	async function initCatalog() {
		const sel = document.getElementById('example-picker');
		let first = 'smoking-cpd.json';

		try {
			const res = await fetch('examples/catalog.json');
			if (!res.ok) throw new Error('HTTP ' + res.status);
			catalogEntries = await res.json();
		} catch (e) {
			// A missing catalog should degrade to "the default model still loads",
			// not to a blank canvas. Load remains available for hand-picked files.
			console.warn('catalog.json unavailable; falling back to the default model', e);
			catalogEntries = [];
		}

		sel.innerHTML = '';
		if (catalogEntries.length) {
			// Group by tier, preserving catalog order — the tiers ARE the reading
			// order (Baseline → Tier 0 structure → Tier 1 inconsistency).
			const tiers = [];
			for (const e of catalogEntries) if (!tiers.includes(e.tier)) tiers.push(e.tier);
			for (const tier of tiers) {
				const grp = document.createElement('optgroup');
				grp.label = tier;
				for (const e of catalogEntries.filter(x => x.tier === tier)) {
					const opt = document.createElement('option');
					opt.value = e.file;
					opt.textContent = e.title;
					grp.appendChild(opt);
				}
				sel.appendChild(grp);
			}
			first = catalogEntries[0].file;
		}
		sel.value = first;

		try {
			await loadExample(first);
		} catch (e) {
			console.error('failed to load ' + first, e);
			if (!pdg) initPDG(undefined);
		}
	}

	$('#example-picker').on('change', async function () {
		if (!this.value) return;
		try { await loadExample(this.value); }
		catch (e) { alert('Failed to load example: ' + e.message); }
	});

	initCatalog();


	$('#save-button').click(function(e){
		download_JSON(pdg.state, 'hypergraph');
	});
	$('#load-button').click(function(e){
		$('#fileupload').click();
	})
	$('#inspector-close').click(function() {
		hideInspector();
	});

	// Inc is genuinely infinite for some models — Ex 2.1 (c1-two-coins) is the
	// canonical one: `dbl` puts probability 0 on T, so any belief with mass on T
	// is infinitely surprising to it. JSON has no literal for that, so the API
	// sends the strings "inf" / "-inf" / "nan". Calling .toExponential() on a
	// string throws, which used to take out the whole score panel.
	function fmtScore(v) {
		if (v === null || v === undefined) return '—';
		if (v === 'inf') return '∞';
		if (v === '-inf') return '−∞';
		if (v === 'nan') return 'NaN';
		const n = typeof v === 'number' ? v : Number(v);
		if (Number.isNaN(n)) return 'NaN';
		if (!Number.isFinite(n)) return n > 0 ? '∞' : '−∞';
		return n.toExponential(3);
	}

	// The marginals are the payoff of the whole exercise. "Inc = 0.675" says little
	// on its own; "Pr(H) = 2/3 at γ=0, 3/4 at γ=1" IS the claim of Ex 4.1.
	function renderMarginals(marginals) {
		const host = document.getElementById('score-marginals');
		host.innerHTML = '';
		if (!marginals) return;
		for (const [v, dist] of Object.entries(marginals)) {
			const row = document.createElement('div');
			row.className = 'marg-row';
			const name = document.createElement('span');
			name.className = 'marg-var';
			name.textContent = v;
			const vals = document.createElement('span');
			vals.className = 'marg-vals';
			vals.textContent = Object.entries(dist)
				.map(([k, p]) => `${k} ${Number(p).toFixed(3)}`)
				.join('  ');
			row.append(name, vals);
			host.appendChild(row);
		}
	}

	function applyScoreResult(result) {
		document.getElementById('score-readout').style.display = '';
		document.getElementById('score-inc').textContent = fmtScore(result.inc);
		document.getElementById('score-idef').textContent = fmtScore(result.idef);
		renderMarginals(result.marginals);
		if (result.edge_scores) pdg.set_edge_scores(result.edge_scores);
		redraw();
	}

	$('#score-button').click(async function() {
		$(this).prop('disabled', true).text('Scoring…');
		try {
			const res = await fetch('/api/score', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hypergraph: pdg.state, gamma: getGamma(), epsilon: getEpsilon()
				})
			});
			if (!res.ok) throw new Error(await res.text());
			applyScoreResult(await res.json());
			lastScoreAction = 'score';
		} catch(e) {
			alert('Score failed: ' + e.message);
		} finally {
			$(this).prop('disabled', false).text('Score');
		}
	});

	$('#optimize-button').click(async function() {
		$(this).prop('disabled', true).text('Optimizing…');
		try {
			const res = await fetch('/api/optimize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hypergraph: pdg.state, gamma: getGamma(),
					epsilon: getEpsilon(), iters: currentIters
				})
			});
			if (!res.ok) throw new Error(await res.text());
			applyScoreResult(await res.json());
			lastScoreAction = 'optimize';
		} catch(e) {
			alert('Optimize failed: ' + e.message);
		} finally {
			$(this).prop('disabled', false).text('Optimize');
		}
	});
	$('#help-toggle').click(function() {
		const body = document.getElementById('help-body');
		const panel = document.getElementById('help-panel');
		const open = !body.hidden;
		body.hidden = open;
		panel.classList.toggle('open', !open);
		$(this).attr('aria-expanded', String(!open));
	});
	$('#fileupload').on('change', function(evt){
		// console.log(evt);
		const reader = new FileReader();
		reader.onload = function(e) {
			// console.log(e);
			let ob = JSON.parse(e.target.result);
			pdg.load(ob);
			hideScoreReadout();
			lastScoreAction = null;
			currentIters = DEFAULT_ITERS;
			// A hand-loaded file is not a catalog entry, so clear the caption rather
			// than leave the previous example's description attached to it.
			document.getElementById('example-picker').value = '';
			showExampleMeta(null);
			// console.log("LOADED HYPERGRAPH:", ob);
		};
		reader.readAsText(evt.target.files[0]);
	})	
	
	// temporary states, for actions
	var temp_link = null;	
	var popup_process = null;
	var popped_up_link = null;
	var action = {};
 
	//##  Next, Updating + Preparing shapes for drawing, starting with a 
	// helpful way of getting average position by node labels.  
	function redraw() {
		context.save();
		context.clearRect(0, 0, canvas.width, canvas.height);

		context.lineWidth = 1.5;
		context.strokeStyle = "black";
		// Reset explicitly rather than trusting the incoming state. This function used
		// to end with an unbalanced save(), so every frame leaked one entry onto the
		// canvas state stack AND left globalAlpha at the 0.2 used by the box-select
		// rectangle. The next frame then inherited 0.2: PDGView.draw() sets its own
		// alpha so arcs were unaffected, but the temp_link rubber band below is drawn
		// at rgba(...,0.4) and rendered at 0.4*0.2 = 0.08 — all but invisible, which
		// made "drag out a new arc" look broken in draw mode.
		context.globalAlpha = 1;

		context.lineCap = 'round';
		// context.setLineDash([]);
		
		for( let M of pdgs ) {
			M.draw(context);
		}

		
		if(temp_link) {
			let midpt = (temp_link.x == undefined) ? undefined : vec2(temp_link);
			let tlpath = pdg.compute_link_shape(temp_link.srcs, temp_link.tgts, midpt);
			
			context.lineWidth = 3;
			context.strokeStyle = "rgba(255,255,255,0.4)";
			context.stroke( tlpath )
			
			context.lineWidth = 1.5;
			context.strokeStyle = "black";
			context.stroke( tlpath )
		}
		context.restore();
		context.save();
		// Draw Selection Rectangle
		context.globalAlpha = 0.2;
		if( action.type == 'box-select' && action.start) {
			// console.log(...corners2xywh(select_rect_start, select_rect_end))
			// context.save();
			// Box-select tint: violet, matching the selection family rather than
			// borrowing a hue from the semantic score ramp.
			context.fillStyle = getComputedStyle(document.documentElement)
				.getPropertyValue('--pdg-select').trim() || "#5f5498";
			
			// context.fillRect(select_rect_start.x, select_rect_start.y, select_rect_end.x, select_rect_end.y);
			// let [xmin,ymin,w,h] = corners2xywh(select_rect_start, select_rect_end);
			context.fillRect(...corners2xywh(action.start, action.end));
			// context.stroke();
			// context.restore();
		}
		// Balances the save() above. Without it the stack grew by one per frame —
		// ~60/second while dragging, since the drag reheats the simulation.
		context.restore();
	}

	d3.select(canvas).call(d3.drag()
			.container(canvas)
			.clickDistance(10)
			.subject(function(event) {
					// console.log("drag.subject passed : ", event)
					if (action.type == 'box-select') return true;
					// else if(action.type == '')
					if (mode == 'draw' && temp_link) return undefined;
					// else {

					let o = pdg.pickN(event);
					if(o) return o;
					let ln = pdg.pickL(event,6,true);
					if(ln) return ln;

					//  if in draw mode, 
					//  create new link source (empty srcs) beginning at target
					if(mode == 'draw') {
						let lo = {link: linkobject(['templink', [[],[]]]), x: event.x, y: event.y};
						return lo;
					}
					// }
				})
			.on("start", dragstarted)
			.on("drag", dragged)
			.on("end", dragended)
		);
	function dragstarted(event) {
		if(popup_process) clearTimeout(popup_process);
			
		if (action.type == 'box-select') {
			action.start = vec2(event);
			action.end = vec2(event);
			pdg.tick();
			console.log("DRAGSTART", action)
		}
		else if(mode == 'move') {
			// if there are no other drag handlers currently firing.
			// apparently useful mostly in multi-touch scenarios.
			if (!event.active) pdg.sim.alphaTarget(0.5).restart();
			if(event.subject.link)  {// it's a link
				event.subject.initial_offset = event.subject.offset;
			} else {  // if it's a node
				event.subject.fx = event.subject.x;
				event.subject.fy = event.subject.y;
				event.subject.anchored = false;
				pdg.align_node_dom();
			}
		}
		else if (mode == 'draw') {
			if(event.subject.link)  { // if it's an edge
				let l = event.subject.link;
				l.display = false; // don't display until it's cancelled or released. 
				temp_link = linkobject(['<TEMPORARY>', [l.srcs, ["<MOUSE>"].concat(l.tgts)]]);
				temp_link.based_on = l;
				temp_link.x = event.subject.x;
				temp_link.y = event.subject.y;
				// temp_link.unit
			} else { // drag.subject is a node.
				temp_link = linkobject(['<TEMPORARY>', [[event.subject.id], ["<MOUSE>"]]]);
			}
			pdg.tick();
		}
	}
	function dragged(event) {
		// console.log(event);
		if (action.type == 'box-select') {
			action.end = vec2(event);
			pdg.tick();
		}
		else if(mode == 'move') {
			if(event.subject.link)  { // if it's an edge
				// console.log(event);
				// event.subject.offset[0] += event.dx;
				// event.subject.offset[1] += event.dy;
			} else {// it's a node
				event.subject.fx = event.x;
				event.subject.fy = event.y;
			}
		} 
		else if (mode == 'draw') {
			// mouse_pt = vec2(event);
			// pdg.lookup["<MOUSE>"] = {x: event.sourceEvent.x,
			// 				y: event.sourceEvent.y,
			// 				w:1,h:1
			mouse.x = event.sourceEvent.x;
			mouse.y = event.sourceEvent.y;
							// setting to negative 9 means the arrow is only shortened 1 pixel.
							// w: -9, h: -9
						// };
			// pdg.tick();
			redraw();
		}
	}
	function dragended(event) {
		if(action.type == 'box-select') {
			action.end = vec2(event);
			action.shift = event.sourceEvent.shiftKey;
			pdg.handle(action)
			
			select_rect_start = null;
			select_rect_end = null;
			action = {};
			redraw();
		}
		if(mode == 'move') {
			if (!event.active){
				// pdg.sim.alpha(1.2).alphaTarget(0).restart();	
				pdg.sim.alphaTarget(0);
			} 
			
			if(event.subject.link)  { // if it's an edge
				// console.log("FINISH DRAG", event);
				// event.subject.offset = [ 
				// 		event.subject.initial_offset[0] + event.,
				// 		event.subject.initial_offset[1] + event.dy ]
			} else {// it's a node	
				if(event.sourceEvent.shiftKey){
					event.subject.anchored = true;
					pdg.align_node_dom();
				}

				if(!event.subject.expanded 
					// && pdg.sim_mode === "all"
					&& !event.subject.anchored
					) {
					event.subject.fx = null;
					event.subject.fy = null;
				}
			}
		}
		else if (mode == 'draw' && temp_link) {
			pdg.handle({
				type : "edge-stroke",
				temp_link : temp_link,
				endpt: {x : event.sourceEvent.x, y : event.sourceEvent.y},
				// source_link : event.subject.link
			});
			temp_link = null;
		}
	}
	
	function set_mode(mode) {
		$("#drag-mode-toolbar button[data-mode='"+mode+"']").click();
	}
	
	canvas.addEventListener("dblclick", function(e) {
		let obj = pdg.pickN(e), link = pdg.pickL(e);
		if(obj) { // rename selected node
			// EXPANDING CODE
			if(!obj.expanded) {
				pdg.sim.stop();
				obj.expanded = true;
				obj.old_wh = [obj.w, obj.h];
				// [obj.w, obj.h] = [550,250];
				[obj.w, obj.h] = [200,150];
				[obj.fx, obj.fy] = [obj.x, obj.y];
				pdg.sim.alpha(2).alphaTarget(0).restart();
			
				for(let ln of pdg.linknodes) {
					// if l.srcs or l.tgts includes n,
					// then set strength to zero?
					// set distance?
				}
			}
			else {
				obj.expanded = false;
				[obj.w, obj.h] = obj.old_wh ? obj.old_wh : [initw,inith];
				delete obj.fx
				delete obj.fy;
				pdg.sim.alpha(2).alphaTarget(0).restart();
			}
			pdg.align_node_dom();
			
			
			//RENAMING CODE
			// let name = promptForName("Enter New Variable Name", obj.id, pdg.all_node_ids);
			// if(!name) return;
			// pdg.rename_node(obj.id, name);
		} else if(link) { // inspect selected edge
			showEdgeInspector(link, redraw);
		} else { // nothing selected; create new variable here.
			setTimeout(function() {
				let name = promptForName("Enter A Variable Name",
					// fresh_node_name(), 
					pdg.fresh_node_name(),
					pdg.all_node_ids);
				if(!name) return;
				
				newtgt = pdg.new_node(name, e.x, e.y);
				if(temp_link) {
					// todo: fold out this functionality, shared with click below.
					new_tgts = temp_link.tgts.slice(1);
					new_tgts.push(newtgt.id);
					pdg.new_link(temp_link.srcs, new_tgts, fresh_label(), [temp_link.x, temp_link.y]);
					temp_link = null;
				}
				pdg.tick();
			}, 10);
		}		
		// if(e.ctrlKey || e.metaKey) {
		// }
	});
	canvas.addEventListener("click", function(e) {
		// ADD NEW NODE
		// if(e.ctrlKey || e.metaKey) {
		if( temp_link ) {
			// let newtgt = pdg.pickN(e);
			// if(!newtgt && mode == 'draw') {
			// 	newtgt = new_node(fresh_node_name(), e.x, e.y);
			// }
			// if(newtgt) {
			// 	if(!e.shiftKey) {
			// 		new_tgts = temp_link.tgts.slice(1);
			// 		new_tgts.push(newtgt.id);
			// 		new_link(temp_link.srcs, new_tgts, fresh_label(), [temp_link.x, temp_link.y]);
			// 		temp_link = null;
			// 	}
			// 	else {
			// 		temp_link.tgts.push(newtgt.id);
			// 	}
			// }
			// console.log("IN CLICK W/ TEMP LINK")
			pdg.handle({
				type : "edge-stroke",
				temp_link : temp_link,
				endpt: {x : event.x, y : event.y},
				// source_link : event.subject.link
			});
			temp_link = null;

		} else if(action.type == 'move') {
			// mouse_end = vec2(lookup['<MOUSE>']);
			mouse_end = vec2(mouse);
			
			action.targets.forEach(n => {
				[n.x, n.y] = addv(n.old_pos, mouse_end, scale(action.mouse_start, -1)); 
				if(n.anchored || (pdg.sim_mode === "linknodes only" && !n.link)) {
					[n.fx, n.fy] = [n.x,n.y];
				}
				delete n.old_pos;
			});
			
			function adjust_seps(ln, n, nsibls, isloop) {
				// ln.sep[n] = mag(subv(vec2(ln), vec2(lookup[n])));
				let p = vec2(ln), 
					q = vec2(lookup[n]),
					wh = [lookup[n].w, lookup[n].h];
				let cur_sep = mag(subv(sqshortened_end(q,p,[ln.w,ln.h]),
									 sqshortened_end(p,q, wh) ));
				let cur_sep_want = ln.sep && ln.sep[n]? ln.sep[n] :
				 	default_separation(nsibls,isloop)
				
				if(cur_sep > cur_sep_want * STRETCH_FACTOR ||
					 	cur_sep < cur_sep_want / STRETCH_FACTOR) 
					ln.sep[n] = cur_sep;
			}
			
			for(let ln of pdg.linknodes) {
				if(action.targets.includes(ln)) {
					ln.sep = {}
					// ## TEMPORARILY COMMENTED OUT; KEEP SEPS SAME
					// for(let n of ln.link.srcs) 
					// 	adjust_seps(ln, n, ln.link.srcs.length, ln.link.tgts.includes(n))
					// 
					// for(let n of ln.link.tgts) 
					// 	adjust_seps(ln, n, ln.link.tgts.length, ln.link.srcs.includes(n))
				}
			}
			// pdg.sim.force("bipartite").links(mk_bipartite_links(linknodes));
			pdg.update_simulation();
			// pdg.update_simulation();
			// for(let n of action.targets) {
			// 
			// }
			action = {};
			pdg.restyle_nodes();
			
		} else if(mode == 'move') { // selection in manipulate mode
			pdg.point_select(e, !e.shiftKey);
			let clickedLink = pdg.pickL(e);
			if (clickedLink) showEdgeInspector(clickedLink, redraw);
			else if (!pdg.pickN(e)) hideInspector();
		}
		// else if(mode == 'select'){
		// 	let link = pickL(e);
		// 	if(link) link.selected = !link.selected;
		// 	// console.log("[Click] " + (link.selected?"":"un")+"selecting  ", link.label, e);
		// 	redraw();
		// }
	});
	window.addEventListener("keydown", function(event){
		if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

		if(event.key == 'Escape'){ // cancel //
			if ( temp_link ) {
				if(temp_link.based_on ) 
					temp_link.based_on.display = true;
				
				temp_link = null;
				redraw();
			}
			else if( action.type == 'move') {
				action.targets.forEach(n => {
					[n.x, n.y] = n.old_pos;
					delete n.old_pos;
				});
			}
			action = {};
			pdg.tick();
		}
		else if (event.key == 'a') {
			pdg.select_all();
		}
		else if (event.key.toLowerCase() == 'b') {
			// $("#drag-mode-toolbar button[data-mode='select']").click();
			// set_mode('select');
			
			action = {
				type: "box-select",
				end : null,
				start : null
			}
		}
		else if (event.key.toLowerCase() == 't') {
			// start creating arrows.
			// 1. Create new arrow from selection at tail
			src = pdg.selected_node_ids
			// src = nodes.filter( n => n.selected ).map( n => n.id );
			// lab = fresh_label();
			// temp_link = new_link(src, ['<MOUSE>'], "<TEMPORARY>");
			temp_link = linkobject(['<TEMPORARY>', [src, ["<MOUSE>"]]], undefined)
			if( src.length == 0) {
				temp_link.x = mouse.x
				temp_link.y = mouse.y
			}
			// set_mode('draw');
			// links.push(temp_link);
		}
		else if (event.key == ' ') {
			event.preventDefault();
			// pdg.sim.alphaTarget(0.05).restart();
			
			// if we're only simulating linknodes, then
			// we still want to un-fix selected nodes on space to reorganize them.
			action = {
				type : "local-simulation",
				targets : pdg.nodes.filter(n => n.selected)
			};
			if(pdg.sim_mode === "linknodes only") { 
				action.targets.forEach(n => {delete n.fx; delete n.fy;})
			}
			
			pdg.sim.alphaTarget(1.5).restart();
			// pdg.sim.alpha(2).alphaTarget(0).restart();
			
			if(mode == 'move') {
			}
			if(mode == 'select') {
				// TODO shift selection to backup selection (red color)
			}
		}
		else if (event.key.toLowerCase() == 'x') {
				pdg.delete_selection();
		}
		else if (event.key == 'd') {
			set_mode("draw");
		}
		else if (event.key == 'm') {
			set_mode("move");
		}
		else if (event.key == "g") {
			// pdg.sim.stop();
			pdg.sim.stop();
			// move selection with mouse
			
			action = {
				type : "move", 
				mouse_start : vec2(mouse),
				targets: pdg.nodes.filter(n => n.selected).concat(pdg.linknodes.filter(ln => ln.link.selected)) 
			}
			
			action.targets.forEach( n => {
				n.old_pos = vec2(n);
			});
		}
		else if (event.key == "s") {
			
		}

	});
	window.addEventListener("keyup", function(event){
		if(action.type === "local-simulation" && event.key == ' ') {
			pdg.sim.alphaTarget(0);
			if(pdg.sim_mode === "linknodes only") { 
				action.targets.forEach( n => { [n.fx,n.fy] = [n.x,n.y]; });
			}
		}		
	});
	canvas.addEventListener("wheel", function(e) {
		// console.log("canvas", e.wheelDelta );
		// lover = pickL(e, width=10);
		
		//# code to change LINE WIDTH
		// if(lover.lw == undefined) lover.lw=2;
		// lover.lw = (lover.lw + sgn(e.wheelDelta) );
		
		
		pdg.tick();
		// console.log(lover);
	});
	window.addEventListener("mousemove", function(e) {
		// mouse_pt = [e.x, e.y];
		// lookup["<MOUSE>"] = {x : e.x, y: e.y, w:0,h:0};
		// console.log("HI");
		// pdg.lookup["<MOUSE>"] = {x : e.x, y: e.y, w:0,h:0};
		
		mouse.x = e.x;
		mouse.y = e.y;
		
		if(temp_link) redraw();
		
		if(popped_up_link && !pdg.picksL(e, popped_up_link, 10)) {
			delete popped_up_link.lw;
			popped_up_link = null;
			pdg.tick();
		}
		
		if(popup_process) clearTimeout(popup_process);
	
		if( !popped_up_link) {
			popup_process = setTimeout(function() {
				let l = pdg.pickL(e, 10);
				popped_up_link = l;

				if(l) {
					l.lw = 5;
					pdg.tick();
				}
			}, 100);
		}

		// if ( mode == 'move'  && action) {
		if(action.type == 'move') {
			action.targets.forEach(n => {
				[n.x, n.y] = addv(n.old_pos, vec2(e), scale(action.mouse_start, -1)); 
			});
			// console.log(action.targets);
			pdg.restyle_nodes();
			// midpoint_aligning_force(1);
			pdg.tick();
			// TODO move selection, like ondrag below
		}
	})
});
