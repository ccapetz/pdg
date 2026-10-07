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

// A cell is "blank" when it has never been filled in. Distinct from 0, which is
// a real claim ("this outcome cannot happen") and the difference that makes
// c1-two-coins infinitely inconsistent — so the two must never be conflated.
function isBlank(v) { return v === null || v === undefined || v === ''; }

function rowBlanks(cpd, combo) {
	return Object.keys(cpd[combo]).filter(t => isBlank(cpd[combo][t]));
}

// A row is finished when nothing is blank and it sums to 1. Both failures get
// the same red, because both mean the same thing to the solver: this is not a
// distribution yet.
function rowIncomplete(cpd, combo) {
	return rowBlanks(cpd, combo).length > 0 || Math.abs(rowSum(cpd, combo) - 1) > 0.001;
}

function cpdIncompleteRows(cpd) {
	return cpd ? Object.keys(cpd).filter(c => rowIncomplete(cpd, c)) : [];
}

// Dirichlet(1,...,1) over k outcomes is the uniform distribution on the simplex:
// every distribution over those k states is equally likely. Sampled the standard
// way — k independent Exp(1) draws, normalized. 1-Math.random() because
// Math.random() can return exactly 0 and log(0) is -Infinity.
function dirichlet1(k) {
	const g = Array.from({length: k}, () => -Math.log(1 - Math.random()));
	const total = g.reduce((a, b) => a + b, 0);
	return g.map(v => v / total);
}

// Fills in what is missing, and only what is missing:
//
//   - a row that is already a distribution is left alone;
//   - a row with blanks whose filled cells sum to s < 1 gets the remaining 1-s
//     mass spread over the blanks by a Dirichlet(1) draw, so the numbers you
//     typed keep the meaning you gave them;
//   - a row with no room left (no blanks, or the filled cells already sum to 1
//     or more, which is what happens when a variable GAINS a state and the old
//     row is already saturated) is resampled whole — there is no way to honour
//     both the old numbers and the new state.
//
// Returns a count of what it did, so the caller can say so.
function autofillCpd(cpd) {
	let filled = 0, resampled = 0;
	for (const combo of Object.keys(cpd)) {
		if (!rowIncomplete(cpd, combo)) continue;
		const states = Object.keys(cpd[combo]);
		const blanks = rowBlanks(cpd, combo);
		const mass = 1 - Object.keys(cpd[combo])
			.filter(t => !isBlank(cpd[combo][t]))
			.reduce((sum, t) => sum + cpd[combo][t], 0);

		if (blanks.length && mass > 1e-9) {
			dirichlet1(blanks.length).forEach((p, i) => { cpd[combo][blanks[i]] = p * mass; });
			filled++;
		} else {
			dirichlet1(states.length).forEach((p, i) => { cpd[combo][states[i]] = p; });
			resampled++;
		}
	}
	return { filled, resampled };
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
		html += `<tr${rowIncomplete(cpd, combo) ? ' class="cpd-row-invalid"' : ''}>`;
		if (link.srcs.length) html += `<td class="text-muted small">${combo}</td>`;
		for (const t of tgtStates) {
			const p = cpd[combo][t];
			// A blank renders blank. Writing 0 into an unfilled cell would assert a
			// probability nobody chose, and 0 is the one value with teeth: an arc
			// that rules out something believed scores Inc = infinity.
			const val = typeof p === 'number' ? p.toFixed(4) : '';
			html += `<td><input type="number" class="cpd-input" min="0" max="1" step="0.0001" value="${val}" data-combo="${combo}" data-tgt="${t}"></td>`;
		}
		html += '</tr>';
	}
	html += '</tbody></table></div>';
	return html;
}

// Click-to-edit for the inspector's title. The displayed name goes through
// renderMathLabel (an arc label may be TeX), so display and edit cannot be the
// same node: clicking swaps in a plain <input> carrying the RAW name, and the
// rendered form comes back on commit. Enter/blur commits, Escape cancels.
//
// `validate` returns a refusal string or null, and comes from the view itself
// (why_not_node_name / why_not_link_label) so the panel refuses exactly what the
// model would, and says why, instead of silently reverting.
function makeRenameable(el, getName, validate, commit) {
	el.classList.add('renameable');
	el.title = 'Click to rename';
	el.onclick = function() {
		if (el.querySelector('input')) return;   // already editing
		const current = getName();
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'rename-input';
		input.value = current;
		input.setAttribute('aria-label', 'Rename');

		const hint = document.createElement('div');
		hint.className = 'rename-refusal';

		el.textContent = '';
		el.append(input, hint);
		input.focus();
		input.select();

		let done = false;
		function finish(accept) {
			if (done) return;
			const name = input.value.trim();
			if (accept && name !== current) {
				const refusal = validate(name, current);
				if (refusal) {                      // stay in the field, say why
					hint.textContent = refusal;
					input.focus();
					return;
				}
				done = true;
				commit(name);
				return;
			}
			done = true;
			el.innerHTML = renderMathLabel(current);
		}
		input.addEventListener('keydown', e => {
			// The window-level keydown handler treats bare letters as edit
			// shortcuts. It bails on INPUT elements, but stopping here too keeps a
			// stray 'x' from ever reaching a delete-selection path.
			e.stopPropagation();
			if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
			if (e.key === 'Escape') { e.preventDefault(); finish(false); }
		});
		input.addEventListener('blur', () => finish(true));
	};
}

// `onEdit` is invoked after any \u03b1/\u03b2 change so the caller can repaint \u2014 \u03b1 and \u03b2 are
// rendered geometrically (opacity and thickness), so an edit that does not repaint
// leaves the picture contradicting the panel. Passed in rather than referenced
// directly because redraw() lives inside the page's jQuery-ready closure.
function showEdgeInspector(link, onEdit, view) {
	const panel = document.getElementById('inspector');
	panel.querySelector('.inspector-empty').style.display = 'none';
	panel.querySelector('.inspector-node').style.display = 'none';
	const content = panel.querySelector('.inspector-content');
	content.style.display = '';

	const titleEl = content.querySelector('.inspector-label');
	titleEl.innerHTML = renderMathLabel(link.label);
	if (view) makeRenameable(titleEl, () => link.label,
		(name, cur) => view.why_not_link_label(name, cur),
		name => {
			view.rename_link(link.label, name);
			showEdgeInspector(link, onEdit, view);   // re-render: the label is the key
			if (onEdit) onEdit();
		});
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
			onCpdChanged();
			if (onEdit) onEdit();
		});
	}

	const cpdEl = panel.querySelector('.inspector-cpd');
	cpdEl.innerHTML = link.cpd
		? buildCpdTable(link)
		: '<span class="no-cpd">No CPD loaded</span>';

	// Autofill is offered only while something is actually missing, and says what
	// it did afterwards — "3 rows filled" vs "1 row resampled" are different
	// events and the second one overwrote numbers, so it should not pass silently.
	const noteEl = panel.querySelector('.cpd-note');

	// Rebind first, then only ever touch the button through a fresh lookup. An
	// earlier version captured the element, called refreshFill(), and only then
	// swapped in the clone — so every later call updated a node that had already
	// been detached from the document, and the button silently failed to come back
	// when an edit re-opened a gap. Look it up each time instead of holding a
	// reference that a later replaceWith can invalidate.
	const staleBtn = document.getElementById('cpd-autofill');
	const fillBtn = staleBtn.cloneNode(true);   // drops listeners bound to a prior arc
	staleBtn.replaceWith(fillBtn);

	const refreshFill = () => {
		const btn = document.getElementById('cpd-autofill');
		const n = cpdIncompleteRows(link.cpd).length;
		btn.hidden = !n;
		btn.textContent = n ? `Autofill ${n} row${n > 1 ? 's' : ''}` : 'Autofill';
	};
	// Where the blanks came from. A cpd that changed shape because a variable
	// gained or lost a value looks identical to one that was never filled in, and
	// the two call for different reactions — so say which one this is, until the
	// table is a distribution again.
	const gaps = cpdIncompleteRows(link.cpd).length;
	if (link.domain_note && gaps) {
		noteEl.textContent = `${link.domain_note}'s values changed \u2014 ` +
			`${gaps} row${gaps > 1 ? 's' : ''} need values. Cells that still had a home kept theirs.`;
		noteEl.classList.add('cpd-note-domain');
	} else {
		if (link.domain_note && view) view.cpd_settled(link);
		noteEl.textContent = '';
		noteEl.classList.remove('cpd-note-domain');
	}
	refreshFill();
	fillBtn.addEventListener('click', () => {
		const { filled, resampled } = autofillCpd(link.cpd);
		showEdgeInspector(link, onEdit, view);
		const said = [];
		if (filled)    said.push(`${filled} row${filled > 1 ? 's' : ''} filled`);
		if (resampled) said.push(`${resampled} row${resampled > 1 ? 's' : ''} resampled whole`);
		panel.querySelector('.cpd-note').textContent =
			said.length ? said.join(', ') + ' \u2014 Dirichlet(1)' : '';
		onCpdChanged();
		if (onEdit) onEdit();
	});

	if (link.cpd) {
		cpdEl.querySelectorAll('.cpd-input').forEach(input => {
			input.addEventListener('change', () => {
				const combo = input.dataset.combo;
				const tgt = input.dataset.tgt;
				// Clearing a cell returns it to blank rather than to 0 — emptying a
				// field is how you say "I have not decided", and 0 says the opposite.
				if (input.value.trim() === '') {
					link.cpd[combo][tgt] = null;
				} else {
					let val = parseFloat(input.value);
					if (isNaN(val)) val = 0;
					val = Math.max(0, Math.min(1, val));
					input.value = val.toFixed(4);
					link.cpd[combo][tgt] = val;
				}
				const row = input.closest('tr');
				row.classList.toggle('cpd-row-invalid', rowIncomplete(link.cpd, combo));
				// Re-offer Autofill the moment an edit opens a gap. This costs one pass
				// over the cells of a single cpd, on commit (change, not keystroke), so
				// it is nowhere near expensive enough to be worth batching: clearing a
				// cell and having to reselect the arc to get the button back is a far
				// higher price than counting a few dozen numbers.
				refreshFill();
				onCpdChanged();
			});
		});
	}
}

// A PDG stores everything quantitative on its ARCS: a node carries no cpd, no
// weight, nothing but a name and a domain. So the node view answers the one
// question a node can answer — "what asserts something about this variable?" —
// and each arc it lists is a shortcut into the full edge view.
//
// The domain is not stored either (`node.values` is a hardcoded [0,1] placeholder
// from PDGView.load, and the JSON schema has no domain field — server.py infers
// domains from cpd keys). We do the same inference here, from an arc that has
// this node as its sole target: its cpd rows are keyed by exactly this node's
// values. Falling back to the source-combo keys of an outgoing arc only works
// when that arc has a single source, or the keys are comma-joined tuples.
function nodeStates(nodeId, links) {
	for (const l of links) {
		if (l.cpd && l.tgts.length === 1 && l.tgts[0] === nodeId) {
			const firstRow = l.cpd[Object.keys(l.cpd)[0]];
			if (firstRow) return Object.keys(firstRow);
		}
	}
	for (const l of links) {
		if (l.cpd && l.srcs.length === 1 && l.srcs[0] === nodeId) {
			return Object.keys(l.cpd);
		}
	}
	return null;
}

function fmtArcScore(v) {
	if (v == null || Number.isNaN(v)) return '';
	if (v === Infinity) return '\u221e';
	const a = Math.abs(v);
	// A consistent model scores at float noise (the smoking BN's arcs come back at
	// ~-1e-17). toFixed(3) renders that as "-0.000", which reads as a real signed
	// quantity; it is zero, so say zero.
	// SCORE_NOISE is pdg-view.js's, so this number and the arc's colour agree on
	// where zero stops.
	if (a < SCORE_NOISE) return '0';
	return a < 0.001 ? v.toExponential(1) : v.toFixed(3);
}

// One row per arc. `onPick` gets the link, so the caller decides what selecting
// means (select on canvas + repaint + open the edge view) without this knowing
// about either pdg or redraw.
function buildArcChip(link, colorOf, onPick) {
	const chip = document.createElement('button');
	chip.type = 'button';
	chip.className = 'arc-chip' + (link.selected ? ' selected' : '');
	// The left border repeats the arc's own colour on the canvas, so the row and
	// the curve it refers to are identifiable as the same thing. Unscored arcs
	// return null, and the chip keeps its neutral hairline.
	const col = colorOf(link);
	if (col) chip.style.setProperty('--chip-accent', col);

	const label = document.createElement('span');
	label.className = 'arc-chip-label';
	label.innerHTML = renderMathLabel(link.label);

	const ends = document.createElement('span');
	ends.className = 'arc-chip-ends';
	// Always written source → target, never relative to the node you clicked: an
	// arc's direction is a fact about the arc, and re-orienting it per panel would
	// make the same arc read differently from its two endpoints.
	const srcs = link.srcs.length ? link.srcs.join(',') : '\u2205';
	ends.textContent = srcs + ' \u2192 ' + link.tgts.join(',');
	ends.title = ends.textContent;

	const score = document.createElement('span');
	score.className = 'arc-chip-score';
	score.textContent = fmtArcScore(link.inc_score);
	if (score.textContent) score.title = 'per-arc inconsistency';

	chip.append(label, ends, score);
	chip.addEventListener('click', () => onPick(link));
	return chip;
}

// The domain editor. One field per value, because the number of fields IS the
// domain size — the thing being edited — and a comma-separated string would hide
// that behind punctuation. Editing a field renames that state everywhere it
// appears; x removes it; + adds one.
//
// Every edit reshapes the cpds of every arc touching this variable, preserving
// each cell whose row and column both survive. Adding a state therefore leaves
// blanks rather than redistributing anyone's numbers, which is the only choice
// that does not silently invent probabilities.
function buildValuesEditor(host, node, pdg, onPick) {
	host.innerHTML = '';
	const values = node.values && node.values.length ? node.values : pdg.default_domain(node.id);

	const refusalEl = document.createElement('div');
	refusalEl.className = 'rename-refusal';

	const reshow = () => showNodeInspector(node, pdg, onPick);

	const row = document.createElement('div');
	row.className = 'value-row';
	values.forEach((v, i) => {
		const cell = document.createElement('span');
		cell.className = 'value-cell';

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'value-input';
		input.value = v;
		input.size = Math.max(3, String(v).length);
		input.setAttribute('aria-label', `value ${i + 1} of ${node.id}`);
		input.addEventListener('keydown', e => {
			e.stopPropagation();                       // canvas shortcuts are single letters
			if (e.key === 'Enter') input.blur();
			if (e.key === 'Escape') { input.value = v; input.blur(); }
		});
		input.addEventListener('change', () => {
			const next = input.value.trim();
			if (next === v) return;
			const refusal = pdg.why_not_value(next, node, v);
			if (refusal) { refusalEl.textContent = refusal; input.value = v; return; }
			pdg.rename_value(node.id, v, next);
			pdg.tick();
			onCpdChanged();
			reshow();
		});

		const del = document.createElement('button');
		del.type = 'button';
		del.className = 'value-del';
		del.textContent = '\u00d7';
		// A variable with one value is not a variable. Below two there is nothing
		// left for a cpd to be a distribution over.
		del.disabled = values.length <= 2;
		del.title = del.disabled
			? 'a variable needs at least two values'
			: `remove ${v} \u2014 its cells go with it`;
		del.addEventListener('click', () => {
			pdg.set_values(node.id, values.filter(x => x !== v));
			pdg.tick();
			onCpdChanged();
			reshow();
		});

		cell.append(input, del);
		row.appendChild(cell);
	});

	const add = document.createElement('button');
	add.type = 'button';
	add.className = 'value-add';
	add.textContent = '+';
	add.title = 'add a value — new cells start blank';
	add.addEventListener('click', () => {
		let i = values.length + 1, name = `v${i}`;
		while (values.includes(name)) name = `v${++i}`;
		pdg.set_values(node.id, [...values, name]);
		pdg.tick();
		onCpdChanged();
		reshow();
	});
	row.appendChild(add);

	const count = document.createElement('span');
	count.className = 'value-count';
	count.textContent = `${values.length} values`;

	host.append(row, count, refusalEl);
}

// Assigned once the view exists; the inspector calls it after any edit that can
// change whether the model is valid.
let onCpdChanged = () => {};

// What is wrong with the model right now, as two lists. An arc is at fault when
// it has no cpd, when a row is unfinished, or when its cpd is keyed by states
// that are not in the variables' domains — the last one catches a hand-written
// file whose two arcs disagree about what values a variable has, which
// infer_domains resolves first-writer-wins and would otherwise hide.
//
// A node is at fault when its domain is not usable: blank or repeated values, or
// fewer than two of them.
function modelFaults(pdg) {
	const arcs = [];
	for (const l of pdg.links) {
		if (!l.cpd) { arcs.push({ l, why: 'no CPD' }); continue; }
		const states = n => (pdg.lookup[n] && pdg.lookup[n].values && pdg.lookup[n].values.length)
			? pdg.lookup[n].values : pdg.default_domain(n);
		const rows = Object.keys(l.cpd);
		const wantRows = pdg.domain_product(l.srcs, states);
		const wantCols = pdg.domain_product(l.tgts, states);
		const haveCols = rows.length ? Object.keys(l.cpd[rows[0]]) : [];
		const shapeOff = rows.length !== wantRows.length
			|| wantRows.some(r => !(r in l.cpd))
			|| haveCols.length !== wantCols.length
			|| wantCols.some(c => !haveCols.includes(c));
		if (shapeOff) { arcs.push({ l, why: "CPD does not match the variables' values" }); continue; }
		const gaps = cpdIncompleteRows(l.cpd).length;
		if (gaps) arcs.push({ l, why: `${gaps} row${gaps > 1 ? 's' : ''} unfinished` });
	}

	const nodes = [];
	for (const n of pdg.nodes) {
		if (!n.display) continue;                       // multinodes are not variables
		const vals = n.values || [];
		if (vals.length < 2) nodes.push({ n, why: 'fewer than two values' });
		else if (vals.some(v => !String(v).trim())) nodes.push({ n, why: 'a value is blank' });
		else if (new Set(vals).size !== vals.length) nodes.push({ n, why: 'repeated values' });
	}
	return { arcs, nodes };
}

function showNodeInspector(node, pdg, onPick) {
	const panel = document.getElementById('inspector');
	panel.querySelector('.inspector-empty').style.display = 'none';
	panel.querySelector('.inspector-content').style.display = 'none';
	panel.querySelector('.inspector-node').style.display = '';

	const nameEl = panel.querySelector('.node-name');
	nameEl.innerHTML = renderMathLabel(node.id);
	makeRenameable(nameEl, () => node.id,
		(name, cur) => pdg.why_not_node_name(name, cur),
		name => {
			pdg.rename_node(node.id, name);
			// Re-render rather than patching the title: every arc row prints the
			// endpoints, so they all carry the old name until redrawn.
			showNodeInspector(node, pdg, onPick);
			pdg.tick();
		});

	buildValuesEditor(panel.querySelector('.node-values'), node, pdg, onPick);

	const incoming = pdg.links.filter(l => l.tgts.includes(node.id));
	const outgoing = pdg.links.filter(l => l.srcs.includes(node.id));

	for (const [links, listSel, countSel, empty] of [
		[incoming, '.node-arcs-in',  '.node-count-in',  'nothing asserts a cpd over this variable'],
		[outgoing, '.node-arcs-out', '.node-count-out', 'this variable conditions nothing'],
	]) {
		const host = panel.querySelector(listSel);
		host.innerHTML = '';
		panel.querySelector(countSel).textContent = links.length ? links.length : '';
		if (!links.length) {
			const none = document.createElement('div');
			none.className = 'node-arcs-empty';
			none.textContent = empty;
			host.appendChild(none);
			continue;
		}
		for (const l of links) host.appendChild(buildArcChip(l, pdg.inc_color, onPick));
	}
}

function hideInspector() {
	const panel = document.getElementById('inspector');
	panel.querySelector('.inspector-empty').style.display = '';
	panel.querySelector('.inspector-content').style.display = 'none';
	panel.querySelector('.inspector-node').style.display = 'none';
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
	const editHistory = createEditHistory();
	let restoringHistory = false;
	let editPending = false;

	function scheduleRecordEdit() {
		if (restoringHistory || !pdg || editPending) return;
		// One gesture can call several mutators (drawing an arc to a new node,
		// reshaping CPDs after a domain edit). Undo should reverse that gesture once.
		editPending = true;
		queueMicrotask(() => {
			editPending = false;
			if (!restoringHistory && pdg) editHistory.record(pdg.state);
		});
	}

	function undoEdit() {
		const previous = editHistory.undo();
		if (!previous || !pdg) return;
		restoringHistory = true;
		try { pdg.load(previous); }
		finally { restoringHistory = false; }
		hideInspector(); // the old inspector points at objects replaced by load()
		hideScoreReadout();
		refreshValidityBanner();
		pdg.tick();
	}

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

	let mouse = { w : 0, h: 0 };

	function initPDG(hypergraph) {
		pdg = PDGView(hypergraph, mouse);
		pdg.notify_change_via(() => {
			refreshValidityBanner();
			hideScoreReadout();
			scheduleRecordEdit();
		});
		// PDGView's constructor calls load(), which fires on_model_change() while it
		// is still the no-op default — the hook is only registered on the line above.
		// So the FIRST model rendered never reported its faults; every later load did.
		// Invisible while the startup model was the valid smoking BN, and wrong the
		// moment the first thing on screen has an unfinished arc.
		refreshValidityBanner();
		pdgs = [pdg];
		pdg.repaint_via(redraw);
		hideScoreReadout();
		editHistory.reset(pdg.state);
	}

	// ── γ / ε controls ───────────────────────────────────────────────────────
	// Once solved, changing γ or ε re-runs Torch. That is what
	// turns C7/C8 from static files into the demo they are meant to be — drag γ
	// from 0 to 1 and watch Pr(H) move 2/3 → 3/4 (Ex 4.1).
	let hasSolved = false;
	let resultEpoch = 0; // discard responses for an edited model or superseded settings

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
		document.getElementById('score-skipped').textContent = '';
		// A distribution belongs to the model that produced it; loading another one
		// must not leave the previous joint on screen under the new picture.
		hasSolved = false;
		resultEpoch++;
		torchResult = null;
		baselineResult = null;
		torchSettings = null;
		baselineSettings = null;
		document.getElementById('compare-results').hidden = true;
		document.getElementById('baseline-compare').open = false;
		document.body.classList.remove('compare-open');
		$('#optimize-button').prop('disabled', false).text('Torch Solve');
		$('#baseline-button').prop('disabled', false).text('Compute factor-product baseline');
		lastDist = null;
		conditionOn = null;
		showDrawer(false);
	}

	function rerunSolve() {
		if (hasSolved) $('#optimize-button').click();
	}

	$('#gamma-slider').on('input', function () {
		document.getElementById('gamma-val').textContent = Number(this.value).toFixed(2);
	});
	// Re-run on `change` (pointer release), not `input` — optimize takes ~0.4 s, so
	// firing per pixel of drag would queue dozens of solves for one gesture.
	$('#gamma-slider').on('change', rerunSolve);
	$('#epsilon-select').on('change', rerunSolve);

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
		// The panel holds a reference to a node/link from the OLD model, which
		// load() has just discarded — editing through a stale panel would write into
		// an object nothing draws.
		hideInspector();

		// Each example ships the γ/ε under which it shows what it is meant to show
		// (C8 needs ε=1e-3 to dodge the opt_joint hard-zero divergence), so applying
		// them is part of loading the example, not a separate step for the user.
		if (entry && typeof entry.gamma   === 'number') setGamma(entry.gamma);
		if (entry && typeof entry.epsilon === 'number') setEpsilon(entry.epsilon);
		currentIters = (entry && typeof entry.iters === 'number') ? entry.iters : DEFAULT_ITERS;

		showExampleMeta(entry);
		hideScoreReadout();
		hasSolved = false;
		editHistory.reset(pdg.state);
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
	// ── Validity banner ──────────────────────────────────────────────────────
	// Recomputed after anything that can break or fix the model. It walks every arc
	// and node, which is cheap enough to do on every edit at these sizes; if a PDG
	// ever gets big enough for that to show, the fix is to recompute the one element
	// that changed, not to update less often — a stale "all clear" is worse than no
	// banner.
	let faultCursor = 0;

	function refreshValidityBanner() {
		const { arcs, nodes } = modelFaults(pdg);
		const banner = document.getElementById('validity-banner');
		const total = arcs.length + nodes.length;
		banner.hidden = !total;
		if (!total) { faultCursor = 0; return; }
		const parts = [];
		if (arcs.length)  parts.push(`${arcs.length} arc${arcs.length > 1 ? 's' : ''}`);
		if (nodes.length) parts.push(`${nodes.length} variable${nodes.length > 1 ? 's' : ''}`);
		// Counted, not listed: at "8 variables, 3 arcs" a list in the corner is a wall
		// of text you cannot act on, and the inspector explains each case in place.
		document.getElementById('validity-text').textContent =
			parts.join(', ') + (total === 1 ? ' needs attention' : ' need attention');
	}
	onCpdChanged = () => {
		refreshValidityBanner();
		hideScoreReadout();
		scheduleRecordEdit();
	};

	// Step through the faults rather than dumping them: each click selects the next
	// offender on the canvas and opens it, so the banner is a way to walk the list.
	$('#validity-banner').click(function() {
		const { arcs, nodes } = modelFaults(pdg);
		const all = [...arcs.map(a => ({ kind: 'arc', ...a })),
		             ...nodes.map(n => ({ kind: 'node', ...n }))];
		if (!all.length) return;
		const pick = all[faultCursor % all.length];
		faultCursor++;
		pdg.links.forEach(l => { l.selected = false; });
		pdg.nodes.forEach(n => { n.selected = false; });
		if (pick.kind === 'arc') {
			pick.l.selected = true;
			showEdgeInspector(pick.l, redraw, pdg);
		} else {
			pick.n.selected = true;
			inspectNode(pick.n);
		}
		pdg.restyle_nodes();
		pdg.restyle_links();
		redraw();
	});

	// Selecting an arc from the node view has to do on the canvas what clicking it
	// would have done — otherwise the panel shows one arc while a different one is
	// highlighted in the picture.
	function inspectNode(node) {
		showNodeInspector(node, pdg, function(link) {
			pdg.links.forEach(l => { l.selected = (l === link); });
			pdg.nodes.forEach(n => { n.selected = false; });
			pdg.restyle_nodes();
			pdg.restyle_links();
			redraw();
			showEdgeInspector(link, redraw, pdg);
		});
	}

	$('#inspector-node-close').click(function() {
		hideInspector();
	});
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

	// ── Distribution drawer ──────────────────────────────────────────────────
	// Everything here is derived from the joint server-side (see _top_atoms,
	// _mutual_info, _conditionals in server.py) because the joint itself is the
	// product of every domain and does not belong on the wire.
	let lastDist = null;        // the most recent {marginals, atoms, mi, conditionals}
	let conditionOn = null;     // "PS=ps" while a value is selected, else null
	let torchResult = null;
	let baselineResult = null;
	let torchSettings = null;
	let baselineSettings = null;

	function fmtProb(p) { return p.toFixed(3); }

	function renderMarginalsCol() {
		const host = document.getElementById('drawer-marginals');
		host.innerHTML = '';
		if (!lastDist) return;
		// Conditioning shows P(. | X=x) for the OTHER variables; the conditioned
		// variable itself is pinned rather than listed as a degenerate 1.000.
		const table = conditionOn && lastDist.conditionals && lastDist.conditionals[conditionOn]
			? lastDist.conditionals[conditionOn]
			: lastDist.marginals;
		document.getElementById('marg-title').textContent =
			conditionOn ? `P( \u00b7 | ${conditionOn.replace('=', ' = ')} )` : 'Marginals';
		document.getElementById('cond-clear').hidden = !conditionOn;

		for (const [v, dist] of Object.entries(table || {})) {
			const row = document.createElement('div');
			row.className = 'marg-line';
			const name = document.createElement('span');
			name.className = 'marg-name';
			name.textContent = v;
			row.appendChild(name);
			for (const [val, p] of Object.entries(dist)) {
				const key = `${v}=${val}`;
				const chip = document.createElement('button');
				chip.type = 'button';
				chip.className = 'marg-chip' + (conditionOn === key ? ' active' : '');
				chip.disabled = !lastDist.conditionals || !(key in lastDist.conditionals);
				chip.title = chip.disabled
					? `${key} has probability 0 — nothing to condition on`
					: `condition on ${key}`;
				// The bar is painted as a background so the number stays readable on
				// top of it; a separate bar element would double the row height for
				// something that is only a rough magnitude cue.
				chip.style.setProperty('--fill', `${Math.round(p * 100)}%`);
				chip.innerHTML = `<span class="chip-val">${val}</span>` +
					`<span class="chip-p">${fmtProb(p)}</span>`;
				chip.addEventListener('click', () => {
					conditionOn = conditionOn === key ? null : key;
					renderMarginalsCol();
				});
				row.appendChild(chip);
			}
			host.appendChild(row);
		}
	}

	function renderAtomsCol() {
		const host = document.getElementById('drawer-atoms');
		host.innerHTML = '';
		const a = lastDist && lastDist.atoms;
		if (!a || !a.atoms.length) return;
		document.getElementById('atoms-title').textContent =
			a.tail_count ? `Top ${a.atoms.length} of ${a.total} worlds` : `All ${a.total} worlds`;

		const max = a.atoms[0].p || 1;
		for (const atom of a.atoms) {
			const row = document.createElement('div');
			row.className = 'atom-row';
			const label = document.createElement('span');
			label.className = 'atom-label';
			label.textContent = a.vars.map(v => atom.assignment[v]).join(' ');
			label.title = a.vars.map(v => `${v} = ${atom.assignment[v]}`).join(', ');
			const bar = document.createElement('span');
			bar.className = 'atom-bar';
			// Scaled against the largest atom, not against 1: on a flat joint every
			// bar would otherwise be a sliver, and the comparison that matters here
			// is between atoms.
			bar.style.width = `${Math.max(1, (atom.p / max) * 100)}%`;
			const val = document.createElement('span');
			val.className = 'atom-p';
			val.textContent = fmtProb(atom.p);
			const track = document.createElement('span');
			track.className = 'atom-track';
			track.appendChild(bar);
			row.append(label, track, val);
			host.appendChild(row);
		}
		if (a.tail_count) {
			const tail = document.createElement('div');
			tail.className = 'atom-tail';
			tail.textContent = `remaining ${a.tail_count} worlds: ${fmtProb(a.tail_mass)}`;
			host.appendChild(tail);
		}
	}

	function renderMiCol() {
		const host = document.getElementById('drawer-mi');
		host.innerHTML = '';
		const mi = lastDist && lastDist.mi;
		if (!mi || mi.vars.length < 2) {
			host.innerHTML = '<div class="drawer-empty">needs two variables</div>';
			return;
		}
		const peak = Math.max(1e-9, ...mi.matrix.flat());
		let html = '<table class="mi-table"><thead><tr><th></th>';
		for (const v of mi.vars) html += `<th>${v}</th>`;
		html += '</tr></thead><tbody>';
		mi.vars.forEach((v, i) => {
			html += `<tr><th>${v}</th>`;
			mi.vars.forEach((w, j) => {
				if (i === j) { html += '<td class="mi-diag"></td>'; return; }
				const val = mi.matrix[i][j];
				// Same grey->red ramp the arcs use, for the same reason: this is a
				// magnitude on a scale whose zero means "nothing here".
				const t = val / peak;
				html += `<td class="mi-cell" style="--t:${t.toFixed(3)}" ` +
					`title="I(${v};${w}) = ${val.toFixed(4)} bits">${val.toFixed(2)}</td>`;
			});
			html += '</tr>';
		});
		html += '</tbody></table>';
		host.innerHTML = html;
	}

	function showDrawer(open) {
		document.getElementById('joint-drawer').hidden = !open;
		document.body.classList.toggle('drawer-open', open);
		document.getElementById('drawer-toggle').hidden = !lastDist;
		document.getElementById('drawer-toggle').innerHTML =
			open ? 'Distribution &#9662;' : 'Distribution &#9652;';
	}

	function renderDistribution(result, source) {
		lastDist = {
			marginals: result.marginals,
			atoms: result.atoms,
			mi: result.mi,
			conditionals: result.conditionals,
		};
		conditionOn = null;
		document.getElementById('drawer-source').textContent = source;
		renderMarginalsCol();
		renderAtomsCol();
		renderMiCol();
		showDrawer(true);
	}

	$('#drawer-close').click(() => showDrawer(false));
	$('#drawer-toggle').click(() => showDrawer(document.getElementById('joint-drawer').hidden));
	$('#cond-clear').click(() => { conditionOn = null; renderMarginalsCol(); });
	$('#baseline-compare').on('toggle', function() {
		document.body.classList.toggle('compare-open', this.open);
	});

	function applyScoreResult(result, source) {
		document.getElementById('score-readout').style.display = '';
		document.getElementById('score-method').textContent = source;
		document.getElementById('score-inc').textContent = fmtScore(result.inc);
		document.getElementById('score-idef').textContent = fmtScore(result.idef);
		// The marginals moved into the drawer, where they sit beside the two things
		// that explain what they left out: the most likely worlds, and the pairwise
		// information the projection destroys.
		renderDistribution(result, source);
		if (result.edge_scores) {
			pdg.set_edge_scores(result.edge_scores);
			// Arcs are SVG (restyle_arcs), not canvas — redraw() below only repaints
			// the canvas, so without this the new score colours did not appear until
			// something else happened to call ontick(): a drag, a resize, a click.
			// Scoring and then not touching the mouse left every arc neutral, which
			// read as "scoring does not colour anything".
			pdg.restyle_links();
		}
		redraw();
	}

	function showResult(kind) {
		const result = kind === 'baseline' ? baselineResult : torchResult;
		if (!result) return;
		const settings = kind === 'baseline' ? baselineSettings : torchSettings;
		const source = kind === 'baseline'
			? 'Factor-product baseline · ε=' + settings.epsilon
			: `Torch solve · γ=${settings.gamma} · ε=${settings.epsilon} · ${settings.iters} iters`;
		applyScoreResult(result, source);
		document.getElementById('show-torch').disabled = kind === 'torch';
		document.getElementById('show-baseline').disabled = kind === 'baseline';
	}

	function renderComparison() {
		const ready = !!torchResult && !!baselineResult;
		document.getElementById('compare-results').hidden = !ready;
		if (!ready) return;
		document.getElementById('torch-inc').textContent = fmtScore(torchResult.inc);
		document.getElementById('torch-idef').textContent = fmtScore(torchResult.idef);
		document.getElementById('baseline-inc').textContent = fmtScore(baselineResult.inc);
		document.getElementById('baseline-idef').textContent = fmtScore(baselineResult.idef);
	}

	$('#show-torch').click(() => showResult('torch'));
	$('#show-baseline').click(() => showResult('baseline'));

	// An arc whose cpd still has blanks is not a distribution, and posting it would
	// either 500 in CPT.from_ddict or, worse, be quietly normalized into numbers
	// nobody chose. It is dropped from the payload instead — which is exactly what
	// the server already does with an arc that has no cpd at all, i.e. the arc
	// stays structural — and the panel says which arcs that happened to, because a
	// score computed over fewer arcs than you can see is otherwise indistinguishable
	// from one computed over all of them.
	function scoreablePayload() {
		const state = pdg.state;
		const kept = {}, skipped = [];
		for (const [label, cpd] of Object.entries(state.cpds || {})) {
			if (cpdIncompleteRows(cpd).length) skipped.push(label);
			else kept[label] = cpd;
		}
		return {
			hypergraph: { ...state, cpds: Object.keys(kept).length ? kept : undefined },
			skipped,
		};
	}

	function renderSkipped(skipped) {
		const el = document.getElementById('score-skipped');
		if (!skipped.length) { el.textContent = ''; return; }
		el.textContent = `${skipped.length} arc${skipped.length > 1 ? 's' : ''} ignored` +
			` \u2014 incomplete CPD: ${skipped.join(', ')}`;
	}

	$('#baseline-button').click(async function() {
		$(this).prop('disabled', true).text('Scoring…');
		const payload = scoreablePayload();
		const runId = ++resultEpoch;
		const epsilon = getEpsilon();
		try {
			const res = await fetch('/api/score', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
						hypergraph: payload.hypergraph, epsilon
					})
			});
			if (!res.ok) throw new Error(await res.text());
			if (runId !== resultEpoch) return;
			baselineResult = await res.json();
			baselineSettings = { epsilon };
			renderComparison();
			renderSkipped(payload.skipped);
		} catch(e) {
			if (runId === resultEpoch) alert('Baseline failed: ' + e.message);
		} finally {
			if (runId === resultEpoch)
				$(this).prop('disabled', false).text('Compute factor-product baseline');
		}
	});

	$('#optimize-button').click(async function() {
		$(this).prop('disabled', true).text('Solving…');
		$('#baseline-button').prop('disabled', true);
		const payload = scoreablePayload();
		const runId = ++resultEpoch;
		const settings = { gamma: getGamma(), epsilon: getEpsilon(), iters: currentIters };
		try {
			const res = await fetch('/api/optimize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
						hypergraph: payload.hypergraph, ...settings
					})
			});
			if (!res.ok) throw new Error(await res.text());
			if (runId !== resultEpoch) return;
			torchResult = await res.json();
			torchSettings = settings;
			baselineResult = null;
			baselineSettings = null;
			renderComparison();
			showResult('torch');
			renderSkipped(payload.skipped);
			hasSolved = true;
		} catch(e) {
			if (runId === resultEpoch) alert('Torch Solve failed: ' + e.message);
		} finally {
			if (runId === resultEpoch) {
				$(this).prop('disabled', false).text('Torch Solve');
				$('#baseline-button').prop('disabled', false);
			}
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
			hideInspector();   // panel still points at the previous model's objects
			hideScoreReadout();
			hasSolved = false;
			currentIters = DEFAULT_ITERS;
			// A hand-loaded file is not a catalog entry, so clear the caption rather
			// than leave the previous example's description attached to it.
			document.getElementById('example-picker').value = '';
			showExampleMeta(null);
			editHistory.reset(pdg.state);
			// console.log("LOADED HYPERGRAPH:", ob);
		};
		reader.readAsText(evt.target.files[0]);
	})	
	
	// temporary states, for actions
	var temp_link = null;	
	var popup_process = null;
	var popped_up_link = null;
	var action = {};
	let dragStartPos = null;
 
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
		// at rgba(...,0.4) and rendered at 0.4*0.2 = 0.08 — all but invisible.
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
					let o = pdg.pickN(event);
					if(o) return o;
					let ln = pdg.pickL(event,6,true);
					if(ln) return ln;
					return { canvas: true, x: event.x, y: event.y };
				})
			.on("start", dragstarted)
			.on("drag", dragged)
			.on("end", dragended)
		);
	function dragstarted(event) {
		if(popup_process) clearTimeout(popup_process);
			
		if (event.subject.canvas) {
			action = { type: 'box-select' };
			action.start = vec2(event);
			action.end = vec2(event);
			pdg.tick();
		}
		else if(event.sourceEvent.shiftKey && !event.subject.link) {
			action = { type: 'draw-edge' };
			temp_link = linkobject(['<TEMPORARY>', [[event.subject.id], ["<MOUSE>"]]]);
			pdg.tick();
		}
		else {
			action = { type: 'drag-move' };
			dragStartPos = [event.subject.x, event.subject.y];
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
	}
	function dragged(event) {
		// console.log(event);
		if (action.type == 'box-select') {
			action.end = vec2(event);
			pdg.tick();
		}
		else if(action.type == 'drag-move') {
			if(event.subject.link)  { // if it's an edge
				// console.log(event);
				// event.subject.offset[0] += event.dx;
				// event.subject.offset[1] += event.dy;
			} else {// it's a node
				event.subject.fx = event.x;
				event.subject.fy = event.y;
			}
		} 
		else if (action.type == 'draw-edge') {
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
		if(action.type == 'drag-move') {
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

				if(!event.subject.anchored) {
					event.subject.fx = null;
					event.subject.fy = null;
				}
				if (dragStartPos && Math.hypot(event.subject.x - dragStartPos[0],
						event.subject.y - dragStartPos[1]) > 2) scheduleRecordEdit();
			}
		}
		else if (action.type == 'draw-edge' && temp_link) {
			pdg.handle({
				type : "edge-stroke",
				temp_link : temp_link,
				endpt: {x : event.sourceEvent.x, y : event.sourceEvent.y},
				// source_link : event.subject.link
			});
			temp_link = null;
		}
		action = {};
		dragStartPos = null;
	}
	
	canvas.addEventListener("dblclick", function(e) {
		let obj = pdg.pickN(e), link = pdg.pickL(e);
		if(obj) {
			inspectNode(obj);
		} else if(link) { // inspect selected edge
			showEdgeInspector(link, redraw, pdg);
		} else { // nothing selected; create new variable here.
			const newNode = pdg.new_node(pdg.fresh_node_name(), e.x, e.y);
			pdg.nodes.forEach(n => { n.selected = (n === newNode); });
			pdg.links.forEach(l => { l.selected = false; });
			pdg.restyle_nodes();
			pdg.restyle_links();
			inspectNode(newNode);
			pdg.tick();
		}		
	});
	canvas.addEventListener("click", function(e) {
		// ADD NEW NODE
		// if(e.ctrlKey || e.metaKey) {
		if( temp_link ) {
			// let newtgt = pdg.pickN(e);
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
				endpt: {x : e.x, y : e.y},
				// source_link : event.subject.link
			});
			temp_link = null;
	
		} else { // selection
			pdg.point_select(e, !e.shiftKey);
			let clickedLink = pdg.pickL(e), clickedNode = pdg.pickN(e);
			// An arc wins over a node under the same pointer, matching point_select,
			// which applies both but treats the link as the more specific pick.
			if (clickedLink) showEdgeInspector(clickedLink, redraw, pdg);
			else if (clickedNode) inspectNode(clickedNode);
			else hideInspector();
		}
	});
	window.addEventListener("keydown", function(event){
		const active = document.activeElement;
		if (active && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return;

		if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			undoEdit();
		}
		else if(event.key == 'Escape'){ // cancel //
			if ( temp_link ) {
				if(temp_link.based_on ) 
					temp_link.based_on.display = true;
				
				temp_link = null;
				redraw();
			}
			action = {};
			pdg.nodes.forEach(n => { n.selected = false; });
			pdg.links.forEach(l => { l.selected = false; });
			pdg.restyle_nodes();
			pdg.restyle_links();
			hideInspector();
			pdg.tick();
		}
		else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() == 'a') {
			event.preventDefault();
			pdg.select_all();
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
		}
		else if (event.key == 'Backspace' || event.key == 'Delete') {
			event.preventDefault();
			pdg.delete_selection();
			hideInspector();
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

	})
});
