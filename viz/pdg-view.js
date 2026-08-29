const initw = 50, inith = 40;
// const STRETCH_FACTOR = 1
const STRETCH_FACTOR = 1.2;
// const STRETCH_FACTOR = 3;

// const OPT_DIST = {0 : 35, 1:50, 2:70, 3:100, 4: 150, 5: 180, 6: 180};
// const OPT_DIST = {1:50, 2:70, 3:100, 4: 110, 5: 120, 6: 130};
// const OPT_DIST = { 1:25,  2:35,  3:50, 4: 65, 5:80, 6:95 };
const OPT_DIST = { 1:25,  2:35,  3:50, 4: 65, 5:80, 6:95 };

function default_separation(nsibls, isLoop) {
	return (nsibls in OPT_DIST ? OPT_DIST[nsibls] : 20*nsibls) + sgn(isLoop)*50;
}


function linkobject([label, [src,tgt]], i) {
	// return { "source" : src.join(","), "target" : tgt.join(","), "index": i};
	return {
		// source + target useful for using as actual force links
		source: src.join(","), 
		target: tgt.join(","), 
		index: i, 
		label: label,
		srcs : src,
		tgts : tgt,
		display: true,
		//## Added Later:
		// path2d, lw, arclen
		//## Actual Data
		cpd : null,
	}
}

function PDGView(hypergraph, mousept) {
		//data from pdgviz.js
	let nodes = [];
	let links = [];
	let linknodes = [];
	// let lookup = [];
	let lookup = { "<MOUSE>" :  mousept };
	
	// let lookup = {
	// 	// get ["<MOUSE>"]() {
	// 	// 	return { x : 0, y : 0, w : 0, h : 0};
	// 	// }
	// 	"<MOUSE>" : { x : 0, y : 0, w : 0, h : 0}
	// };
	let parentLinks = [];
	let repaint = () => undefined
	
	// let sim_mode = "linknodes only";  // can also be "all"
	let sim_mode = "all";

	let canvas = document.getElementById("canvas")
	let context = canvas.getContext("2d");
	
	// let 
		
	let simulation = undefined
	// Whether the hypergraph currently loaded shipped its own `viz` coordinates.
	// Read by mk_simulation(), which runs AFTER the constructor's load() and would
	// otherwise scramble a hand-placed layout. See the note there.
	let has_pinned_layout = false
	// 
	svgg = d3.select("#svg").append("g")
		.classed("PDG", true)
	
	if(hypergraph !== undefined) {
		load(hypergraph)
	}
	
	function load(hypergraph) {
		if(typeof simulation != "undefined") {
			simulation.stop();
		}
		
		has_pinned_layout = !!hypergraph.viz;

		// clear state
		parentLinks = [];
		lookup = { "<MOUSE>" :  mousept };
		nodes = [];
		linknodes = [];
		links = []
		svgg.selectAll(".node").data([]).exit().remove();
		// align_node_dom();
		
		// load nodes
		nodes = hypergraph.nodes.map( function(varname) {
			let ob = {id: varname, values: [0,1],
				w : initw, h: inith, display: true};
			lookup[varname] = ob;
			return ob;
		});
		
		// load saved node properties
		if(hypergraph.viz && hypergraph.viz.nodes) {
			for( const [nid, propobj] of Object.entries(hypergraph.viz.nodes)){
				Object.assign(lookup[nid], propobj)
			}
		}
		align_node_dom();		

		
		// load hyper-edges
		let ED = hypergraph.hedges;
		for (label in ED) {
			for(var multi of ED[label]) {
				ensure_multinode(multi);
			}
		}
		links = Object.entries(ED).map(linkobject);
		linknodes = links.map(mk_linknode)
		
		// load saved viz properties for link-nodes (e.g., link positions)
		if(hypergraph.viz && hypergraph.viz.linknodes) {
			hypergraph.viz.linknodes.forEach( function([label, ob]) {
				let ln = linknodes.find(ln => ln.link.label == label);
				Object.assign(ln, ob);
			});
		} 
		if(hypergraph.viz && hypergraph.viz.links) {
			hypergraph.viz.links.forEach( function([label, ob]) {
				let l = links.find(l => l.label == label);
				Object.assign(l, ob);
			});
		}

		// load CPD data if present
		if(hypergraph.cpds) {
			for(let l of links) {
				if(hypergraph.cpds[l.label]) {
					l.cpd = hypergraph.cpds[l.label];
				}
			}
		}

		// Per-arc confidences. These have to survive the browser round-trip: the UI
		// posts `pdg.state` (i.e. current_hypergraph()) to /api/score and
		// /api/optimize, so anything not carried here is silently replaced by the
		// server's default of 1.0. That is not cosmetic — c7-factorgraph-merged
		// differs from c7-factorgraph-drift ONLY in alpha (.5 vs 1 on each of J1,J2),
		// and dropping it collapsed the two onto the same answer (.842) instead of
		// the .842-vs-.700 split that is the whole point of Ex 3.6.
		//
		// Values are stored verbatim rather than parsed, because "inf"/"∞" are legal
		// JSON forms that server.py's _as_weight understands; coercing here would
		// only lose that.
		if(hypergraph.alpha) {
			for(let l of links) {
				if(l.label in hypergraph.alpha) l.alpha = hypergraph.alpha[l.label];
			}
		}
		if(hypergraph.beta) {
			for(let l of links) {
				if(l.label in hypergraph.beta) l.beta = hypergraph.beta[l.label];
			}
		}

		
		// if simulation exists, update nodes & edges of simulation + restart.
		if(typeof simulation != "undefined") {
			simulation.nodes(nodes.concat(linknodes));
			// update_simulation();
			restyle_nodes();
			restyle_links();
			// 
			// console.log(links.map(l => l.srcs));
			// console.log(linknodes.map(ln => ln.link));
			// simulation.force('bipartite').links(mk_bipartite_links(links));
			simulation.force('bipartite').links(mk_bipartite_links(linknodes));
			
			if( ! hypergraph.viz ){
				reinitialize_node_positions();
			}
			else {
				settle_pinned_layout();
			}

		}
	}

	// A file that carries `viz` coords has already been laid out — by hand, or by
	// gen_catalog_examples.py so it matches the dissertation figure. Reheating the
	// simulation, even to alpha 0.05, walks everything off those coordinates: the
	// bipartite force drags link-nodes toward their variables, so what you see
	// depends on how long ago the file loaded. That made the C7 pair — identical
	// layouts, on purpose, so that only α differs — render as two visibly different
	// pictures, which is the opposite of the point.
	//
	// ontick() alone recomputes every path2d from the current positions, so the
	// layout draws correctly without the simulation running at all. Dragging
	// reheats via alphaTarget (pdgviz.js:487), so interaction is unaffected; force
	// layout stays available for AUTHORING and is simply not the reading mode.
	function settle_pinned_layout() {
		simulation.stop();
		ontick();
	}
	
	function current_hypergraph() {
		let hedges = {}
		for(let l of links) {
			hedges[l.label] = [l.srcs, l.tgts];
		}
		// collect CPD data from links that have it
		let cpds = {};
		for(let l of links) {
			if(l.cpd) cpds[l.label] = l.cpd;
		}
		// α and β, same deal as cpds: omitted entirely when no arc carries one, so
		// that the server falls through to the PDG default rather than receiving a
		// map of explicit 1.0s that would obscure "unset" vs "set to 1".
		let alpha = {}, beta = {};
		for(let l of links) {
			if(l.alpha !== undefined) alpha[l.label] = l.alpha;
			if(l.beta  !== undefined) beta[l.label]  = l.beta;
		}

		return {
			nodes : nodes.map(n => n.id),
			hedges : hedges,
			cpds : Object.keys(cpds).length ? cpds : undefined,
			alpha : Object.keys(alpha).length ? alpha : undefined,
			beta : Object.keys(beta).length ? beta : undefined,
			viz : {
				nodes : Object.fromEntries(nodes.map(
						n => [n.id, cloneAndPluck(n, ["x", "y", "w", "h", "selected", "expanded"])]
						// n => [n.id, n]
					)),
				linknodes : linknodes.map(
					// ln =>  [ln.link.label, cloneAndPluck(ln, ["x", "y", "w", "h"] )]
					ln =>  [ln.link.label, cloneAndPluck(ln, ["x", "y", "w", "h", "sep" ] )]
				),
				links : links.map(
					l =>  [l.label, cloneAndPluck(l, ["selected" ] )]
				)
			}
		}
	}

	function ensure_multinode(multi) {
		s = multi.join(',')
		if( ! nodes.find(n => n.id == s )) {
			let ob = {id:s, 
				// w:6, h:6, display: false,
				w:2, h:2, display: false,
				components: multi,
				vx:0.0, vy:0.0};
			
			if( multi.length > 0 ) 
				[ob.x, ob.y] = avgpos(...multi); // defined below.
		
			// nodes.push(ob);
			lookup[s] = ob;
			multi.forEach(n =>
				parentLinks.push({"source" : s, "target" : n}) );
		};
	}
	function avgpos( ... nodenames ) {
		return   [ d3.mean(nodenames.map(v => lookup[v].x)),
					 d3.mean(nodenames.map(v => lookup[v].y)) ];
	}
	function mk_linknode(link) {
		let avg = avgpos(...link.srcs, ...link.tgts)
		let ob = {
			// id: link.label+link.source+link.target
			id: "ℓ"+link.label, 
			link: link,
			x: avg[0] + 10*Math.random()-5,
			y: avg[1] + 10*Math.random()-5,
			offset: [0,0], vx: 0, vy:0,
			// w : 5, h : 5,
			w : 0, h : 0,
			display: false};
		return ob;
	}
	
	function compute_link_shape(src, tgt, midpt=undefined,
			return_mid=false, arrwidth=undefined) {
		if(arrwidth == undefined) arrwidth=10;
		// let srcnode = lookup[src.join(",")];
		// let avgsrc = vec2(srcnode);
		// if( src.length > 0 ) {
		// 	avgsrc = avgpos(...src);
		// }
		let avgsrc = src.length==0 ? (midpt ? midpt : vec2(lookup[''])) : avgpos(...src);
		
		// let tgtnode = lookup[tgt.join(",")];
		// let avgtgt = vec2(tgtnode);
		// if( tgt.length == 0 ) {
		// 	avgtgt = avgpos(...tgt);
		// }
		let avgtgt = tgt.length==0 ? (midpt ? midpt : vec2(lookup[''])) : avgpos(...tgt);

		// let mid = [ 0.4*avgsrc[0] + 0.6*avgtgt[0], 0.4*avgsrc[1] + 0.6*avgtgt[1] ];
		// let mid = midpt ? midpt : 
		let mid = [ 0.4*avgsrc[0] + 0.6*avgtgt[0], 0.4*avgsrc[1] + 0.6*avgtgt[1] ];
		// console.log('ho', avgsrc,avgtgt, mid);
		function shortener(s) {
			return sqshortened_end(mid, vec2(lookup[s]), [lookup[s].w, lookup[s].h], 10);
		}
		let avgsrcshortened = src.length == 0 ? 
			(midpt ? midpt: shortener("")) : scale(addv(... src.map(shortener)), 1 / src.length);
		let avgtgtshortened = tgt.length == 0 ?
			(midpt ? midpt: shortener("")) : scale(addv(... tgt.map(shortener)), 1 / tgt.length);
		let midearly = mid;
		// mid = [ .5*avgsrcshortened[0] + .5*avgtgtshortened[0],
		// 	.5*avgsrcshortened[1] + .5*avgtgtshortened[1] ];
		let true_mid = [ .5*avgsrcshortened[0] + .5*avgtgtshortened[0],
			.5*avgsrcshortened[1] + .5*avgtgtshortened[1] ];
		mid = midpt ? midpt : true_mid;
		// mid = true_mid;
		let delta = subv(mid, true_mid);
		// let avgtgtshortened = addv(
		// 	...tgt.map(t =>
		// 		sqshortened_end(mid, vec2(lookup[t]), [lookup[t].w, lookup[t].h]))
		// 			/ tgt.length
		// );
		
		let lpath = new Path2D();
		src.forEach( function(s) {
			// lpath.moveTo(...shortener(s));
			// lpath.moveTo(lookup[s].x, lookup[s].y);
			startpt = shortener(s);
			lpath.moveTo(...startpt);
			// lpath.quadraticCurveTo(avgsrcshortened[0], avgsrcshortened[1], mid[0], mid[1]);
			// lpath.bezierCurveTo(
			// 		// avgtgt[0], avgtgt[1],
			// 		0.2*midearly[0] + startpt[0]*(0.8),
			// 		0.2*midearly[1] + startpt[1]*(0.8),
			// 		.8*avgsrcshortened[0] + mid[0]*(0.2),
			// 		.8*avgsrcshortened[1] + mid[1]*(0.2),
			// 		// lookup[s].x, lookup[s].y,
			// 		mid[0], mid[1]);
			// lpath.bezierCurveTo(
			// 		// avgtgt[0], avgtgt[1],
			// 		0.2*midearly[0] + startpt[0]*(0.8) + delta[0] * 0.9,
			// 		0.2*midearly[1] + startpt[1]*(0.8) + delta[1] * 0.9,
			// 		.8*avgsrcshortened[0] + true_mid[0]*(0.2) + delta[0] * 1.8,
			// 		.8*avgsrcshortened[1] + true_mid[1]*(0.2) + delta[1] * 1.8,
			// 		// lookup[s].x, lookup[s].y,
			// 		mid[0], mid[1]);
			
			
			lpath.bezierCurveTo(
					// avgtgt[0], avgtgt[1],
					// 0.2*midearly[0] + startpt[0]*(0.8) + delta[0] * 0,
					// 0.2*midearly[1] + startpt[1]*(0.8) + delta[1] * 0,
					 0.2*mid[0] + startpt[0]*(0.8) + delta[0] * 0,
					 0.2*mid[1] + startpt[1]*(0.8) + delta[1] * 0,
					.8*avgsrcshortened[0] + true_mid[0]*(0.2) + delta[0],
					.8*avgsrcshortened[1] + true_mid[1]*(0.2) + delta[1],
					// lookup[s].x, lookup[s].y,
					mid[0], mid[1]);

			// lpath.moveTo(...startpt);
			// lpath.lineTo(mid[0], mid[1]);
		});
		tgt.forEach( function(t) {
			// lpath.moveTo( true_mid[0], true_mid[1] );
			lpath.moveTo(...mid);
			// lpath.quadraticCurveTo(avgtgt[0], avgtgt[1], lookup[t].x, lookup[t].y);
			let endpt = shortener(t);
			// console.log(mid, vec2(lookup[t]), endpt);
			// scale(delta, Math.max(0, norm-35) / norm )

			// lpath.quadraticCurveTo(avgtgtshortened[0], avgtgtshortened[1], endpt[0], endpt[1]);
			// lpath.lineTo(...endpt);
			central_ctrl = [
					.8*avgtgtshortened[0] + true_mid[0]*(0.2) + delta[0],
					.8*avgtgtshortened[1] + true_mid[1]*(0.2) + delta[1],
				];
			proximal_ctrl =  [
					0.2*mid[0] + endpt[0]*(0.8) + delta[0] * 0,
					0.2*mid[1] + endpt[1]*(0.8) + delta[1] * 0 
				];
			lpath.bezierCurveTo(...central_ctrl, ...proximal_ctrl, ...endpt);
					// lookup[s].x, lookup[s].y,
					// endpt[0], endpt[1]);
			
			
			
			// ### DRAW ARROWS
			// let [ar0, ar1, armid0, armid1] = arrowpts(mid, endpt, arrwidth);
			// let [ar0, ar1, armid0, armid1] = arrowpts(central_ctrl, endpt, arrwidth);
			let [ar0, ar1, armid0, armid1] = arrowpts(meldv(central_ctrl,proximal_ctrl,0.8), endpt, arrwidth);
			lpath.moveTo(...endpt);
			lpath.quadraticCurveTo(armid0[0], armid0[1], ar0[0], ar0[1]);
			lpath.moveTo(...endpt);
			lpath.quadraticCurveTo(armid1[0], armid1[1], ar1[0], ar1[1]);
		});
		if(return_mid) return [lpath, true_mid];
		return lpath;
	}

	function ontick() {
		// for (let l of links) {
		// 	l.path2d = compute_link_shape(l.srcs,l.tgts);
		// }
		for (let ln of linknodes) {
			let l = ln.link;
			// `l.lw ?? 2`, not `l.lw | 2`: the inherited idiom was a BITWISE or, which
			// happens to yield 2 for undefined but silently corrupts real widths —
			// the hover highlight sets l.lw = 5 (pdgviz.js:884) and 5|2 renders as 7.
			// Harmless while nothing multiplied it; beta_scale now does.
			[l.path2d, ln.true_mid] = compute_link_shape(l.srcs, l.tgts, vec2(ln), true, (l.lw ?? 2)*1.5+6);
		}

		// Clamp to the canvas boundary — but ONLY when the canvas is actually big
		// enough to hold the node. On a cold start the pane can still be sizing, so
		// canvas.width reads 0 and the range INVERTS: lo = n.w/2 = 25, hi = -25.
		// clamp() has no guard for lo > hi, so it returns -25 on the first tick and
		// then 25 on the next, parking every node at exactly (w/2, h/2) — the whole
		// graph collapses into the top-left corner as a single dot.
		//
		// This used to self-repair, because the running simulation re-ticked once the
		// real size arrived. settle_pinned_layout() now stops the simulation outright,
		// so nothing recomputes and the corruption is PERMANENT: startup rendered a
		// blank canvas while the very same file loaded from the dropdown was fine.
		// Skipping the clamp leaves the pinned coordinates untouched, and
		// resizeCanvas() re-ticks when the real dimensions land.
		nodes.concat(linknodes).forEach(function(n) {
			if (canvas.width  > n.w) n.x = clamp(n.x, n.w/2, canvas.width  - n.w/2);
			if (canvas.height > n.h) n.y = clamp(n.y, n.h/2, canvas.height - n.h/2);
		});
		
		
		restyle_nodes();
		restyle_links();
		repaint();
	}
	let _inc_max = 0;

	// The API sends non-finite scores as the strings "inf" / "-inf" / "nan",
	// because JSON has no literal for them. Ex 2.1 (c1-two-coins) genuinely
	// optimizes to Inc = ∞, so this is a normal value, not an error.
	function parse_score(v) {
		if (v === null || v === undefined) return null;
		if (typeof v === 'number') return v;
		if (v === 'inf') return Infinity;
		if (v === '-inf') return -Infinity;
		if (v === 'nan') return NaN;
		const n = Number(v);
		return Number.isNaN(n) ? null : n;
	}

	// Infinite inconsistency is a DIFFERENT KIND of thing, not just a large number,
	// so it gets its own channel rather than the top of the ramp. In Ex 2.1 the
	// worst finite edge (`fair`, 0.326) is also the ramp max, so pinning ∞ to t=1
	// rendered both edges the same red — erasing the asymmetry that IS the example.
	// Hue plus dash pattern, so the distinction survives red/magenta colorblindness.
	// Palette lives in viz.css (:root) so the legend, the canvas and the CSS-styled
	// SVG cannot drift apart. Canvas needs real values, not var() references, so
	// read the tokens once at startup.
	const _tok = (name, fallback) => {
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	};
	const PAL = {
		green: _tok('--pdg-green', '#487050'),
		grey:  _tok('--pdg-grey',  '#b8b8b8'),
		red:   _tok('--pdg-red',   '#884838'),
		ink:   _tok('--pdg-ink',   '#201820'),
		inf:   _tok('--pdg-inf',   '#4a1f2e'),
		select:      _tok('--pdg-select', '#5f5498'),
		selectCasing:_tok('--pdg-select-casing', 'rgba(228,224,240,0.85)'),
	};
	const INC_INF_COLOR = PAL.inf;

	function _hex2rgb(h) {
		h = h.replace('#', '');
		if (h.length === 3) h = h.split('').map(c => c + c).join('');
		return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
	}
	function _mix(c0, c1, t) {
		const a = _hex2rgb(c0), b = _hex2rgb(c1);
		return `rgb(${a.map((v,i) => Math.round(v + (b[i]-v)*t)).join(',')})`;
	}

	function is_inf_score(l) {
		return l && l.inc_score === Infinity;
	}

	// Figure 3.4's scale: grey = 0 (neutral), red = +1 (worse fit), green = -1
	// (better fit). Edge scores are non-negative, so in practice this is the
	// grey->red half; the green branch exists so a negative value would be shown
	// honestly rather than clamped to grey.
	function inc_color(l) {
		if (l.inc_score == null || Number.isNaN(l.inc_score)) return null;
		if (l.inc_score === Infinity) return INC_INF_COLOR;
		if (_inc_max === 0) return null;
		if (l.inc_score < 0) {
			const t = Math.min(1, -l.inc_score / _inc_max);
			return _mix(PAL.grey, PAL.green, t);
		}
		return _mix(PAL.grey, PAL.red, Math.min(1, l.inc_score / _inc_max));
	}

	// Mirrors server.py's _as_weight: α/β may arrive as the strings "inf" / "∞",
	// since JSON has no infinity literal.
	function as_weight(v) {
		if (v === null || v === undefined) return null;
		if (typeof v === 'number') return Number.isNaN(v) ? null : v;
		if (v === 'inf' || v === '∞' || v === 'Infinity') return Infinity;
		const n = Number(v);
		return Number.isNaN(n) ? null : n;
	}

	// β = confidence in the cpd, so it maps to how heavily the arc is drawn.
	// Log scale, because β is precision-like and people set it to 1, 10, 100 —
	// linear thickness would make β=10 a slab and β=100 unusable. Pinned so that
	// β=1, the default, reproduces the previous width exactly; an unset β must not
	// change how anything already on disk looks.
	const BETA_LW_MIN = 0.4, BETA_LW_MAX = 3;
	function beta_scale(l) {
		const b = as_weight(l.beta);
		if (b === null || !(b > 0)) return 1;
		if (!Number.isFinite(b)) return BETA_LW_MAX;
		return Math.min(BETA_LW_MAX, Math.max(BETA_LW_MIN, 1 + 0.6 * Math.log2(b)));
	}

	// α = confidence in the functional dependence. Opacity, because it is the only
	// channel left: thickness is β, hue is the inconsistency score, and dash is
	// reserved for Inc=∞. Floored at 0.3 so an α=0 arc is still findable and
	// clickable rather than invisible. Together these make "proper PDG" (β ≫ α) a
	// property you can see — a thick, faint arc — instead of one you have to query.
	function alpha_opacity(l) {
		const a = as_weight(l.alpha);
		if (a === null || !Number.isFinite(a)) return 1;
		return Math.min(1, Math.max(0.3, 0.3 + 0.7 * Math.min(a, 1)));
	}

	function draw(context) {
		// try/finally so the save() is always balanced. `context.stroke(path2d)`
		// throws if path2d is undefined, which is reachable: a newly drawn arc has no
		// path2d until the next ontick(), and restyle_links() can repaint() inside
		// that window. Previously an escaping exception skipped restore() and grew the
		// canvas state stack by one every frame; now it would also strand globalAlpha
		// mid-link, tinting everything drawn afterwards.
		context.save();
		try {
		context.globalAlpha = 1;
		for( let l of links) {
			// let lw = l.hasAttribute('lw')? l.lw : 2;
			if(!l.display) continue;
			let lw = (l.lw ?? 2) * beta_scale(l);
			context.globalAlpha = 1;
			context.lineWidth = lw * 1.2 + 3;
			// Casing stays opaque even when the arc itself is faded: it is there for
			// legibility against whatever the arc crosses, not to carry data.
			context.strokeStyle = l.selected ? PAL.selectCasing : "rgba(255, 255, 255, 0.7)";
			context.stroke(l.path2d);

			context.globalAlpha = alpha_opacity(l);
			context.lineWidth =  lw;
			const col = inc_color(l);
			// Selection is violet, deliberately outside the grey->red->green semantic
			// ramp: a selected arc must never be mistakeable for a scored one.
			context.strokeStyle = l.selected ? PAL.select : (col || PAL.ink);
			// Dash infinitely-inconsistent edges: a second, redundant cue so the
			// "this cpd assigns probability 0 to something you believe" case is
			// legible without relying on hue alone.
			const dashed = is_inf_score(l) && !l.selected;
			if (dashed) context.setLineDash([Math.max(4, lw * 2), Math.max(3, lw)]);
			context.stroke(l.path2d);
			if (dashed) context.setLineDash([]);
			context.globalAlpha = 1;
			// context.lineWidth = 1;
			// context.setLineDash([4,1]);
			// context.strokeStyle = 'red';
			// context.beginPath();
			// // context.moveTo(srcnode.x, srcnode.y);
			// // context.lineTo(tgtnode.x, tgtnode.y);
			// context.moveTo(...avgsrcshortened);
			// context.lineTo(...avgtgtshortened);
			// context.stroke();
		}
		
		
		
		//DEBUG: Draw ex and ey of nodes
		// context.globalAlpha = 0.7;
		// for (let n of nodes) {
		// 	if(n.ex && n.ey) {
		// 		context.fillStyle="#A4C";
		// 		context.beginPath();
		// 		context.arc(n.ex, n.ey, 10, 0, 2 * Math.PI);
		// 		context.fill();
		// 	}
		// 	if(n.ex2 && n.ey2) {
		// 		context.fillStyle="#CA4";
		// 		context.beginPath();
		// 		context.arc(n.ex2, n.ey2, 10, 0, 2 * Math.PI);
		// 		context.fill();
		// 	}
		// }
		
		/// Draw the invisible product nodes + make sure no node goes off screen.
		context.globalAlpha = 0.5;
		context.lineWidth = 2;
		nodes.forEach(function(n) {
			if(! n.display ) {
				context.beginPath();

				if( n.selected )
					context.strokeStyle="#EA2";
				else context.strokeStyle="#AAA";
				
				context.moveTo(n.x, n.y);
				context.arc(n.x, n.y, 3, 0, 2 * Math.PI);
				context.stroke();				
			}
		});

		// context.fillStyle="#888";
		} finally {
			context.restore();
		}

	
		//draw the linknodes 
		// linknodes.forEach(function(n) {
		// 	context.moveTo(n.x, n.y);
		// 	context.beginPath();
		// 	// context.fillStyle="#A4C";
		// 	context.arc(n.x, n.y, 7, 0, 2 * Math.PI);
		// 	context.fill();				
		// });
	}

	function multi_avgpos_alignment_force(alpha) {
		for(let n of nodes) {
			if (n.components && n.components.length > 1) {
				// console.log('working?');
				let avg = avgpos(...n.components);
				// let delta = subv(avg, vec2(n));
				// let scale = Math.pow(mag(delta), alpha);
				// n.vx += sgn(avg[0] - n.x) * scale * 1
				// n.vy += sgn(avg[1] - n.y) * scale * 1 
				
				n.vx += (avg[0] - n.x) * 0.5 * alpha;
				n.vy += (avg[1] - n.y) * 0.5 * alpha;
				
				// n.vx += (avg[0] - n.x) * 0.3;
				// n.vy += (avg[1] - n.y) * 0.3;
			}
		}
		// now even out forces
		// for( let l of links) {
			//// TODO softly even out distances between components across links.
		// }
	}
	function midpoint_aligning_force(alpha) {
		// let strength = 0.3 // 0.35
		let strength = 0.2 // 0.35
		for (let ln of linknodes) {
			let l = ln.link;
			if(l.srcs.length ==0) continue;
			[l.path2d, ln.true_mid] = compute_link_shape(l.srcs, l.tgts, vec2(ln), true);
			// ln.x += (mid[0] - ln.x) * 0.25;
			// ln.y += (mid[1] - ln.y) * 0.25;
			// ln.vx += (ln.true_mid[0] + ln.offset[0] - ln.x - ln.vx) * strength * alpha; 
			// ln.vy += (ln.true_mid[1] + ln.offset[1] - ln.y - ln.vy) * strength * alpha;
			
			// ln.x += (ln.true_mid[0] + ln.offset[0] - ln.x - ln.vx) * strength * alpha; 
			// ln.y += (ln.true_mid[1] + ln.offset[1] - ln.y - ln.vy) * strength * alpha;
			
			ln.vx += (ln.true_mid[0] + ln.offset[0] - ln.x - ln.vx) * strength * alpha; 
			ln.vy += (ln.true_mid[1] + ln.offset[1] - ln.y - ln.vy) * strength * alpha;
		
			// ln.x += (ln.true_mid[0] + ln.offset[0] - ln.x) * strength * alpha; 
			// ln.y += (ln.true_mid[1] + ln.offset[1] - ln.y) * strength * alpha;
		}
	}
	
	
	function mk_bipartite_links(linknodes){
		let bipartite_links = []
		// for( let l of links) {
		// let lname = "ℓ" + l.label;
		for( let ln of linknodes) {
			let l = ln.link;
			let lname = ln.id;
			
			for( let s of l.srcs) {
				bipartite_links.push({ 
					source: s, target: lname, 
					n : s, ln : ln,
					separation : 
						ln.sep && ln.sep[s] ? ln.sep[s] : 
						default_separation(l.srcs.length, l.tgts.includes(s)),
					// nsibls: l.srcs.length, 
					// isloop: l.tgts.includes(s)
				});
			}
			// delta = l.srcs.length == 0 ?  -1 : 0;
			for( let t of l.tgts) {
				bipartite_links.push({
					source: lname, target: t, 
					n : t, ln : ln,
					separation : 
						ln.sep && ln.sep[t] ? ln.sep[t] : 
						default_separation(l.tgts.length, l.srcs.includes(t)),
					// nsibls: l.tgts.length, 
					// isloop: l.srcs.includes(t) 
				});
			}
		}
		return bipartite_links;
	}
	function reinitialize_node_positions() {
		for (let node of nodes) {
			node.x = node.x * 10.8 + canvas.width/2;
			node.y = node.y * 10.8 + canvas.height/2;
		} 
		for(let ln of linknodes) {
			tgtavg = avgpos(...ln.link.tgts);
			if(ln.link.srcs.length == 0)
				[ln.x, ln.y] = tgtavg;
			else
				[ln.x, ln.y] = scale( addv(tgtavg, avgpos(...ln.link.srcs)), 0.5);
		}
		ontick(); 
		simulation.alpha(2).restart();
	} 
	function mk_simulation() {
		simulation = d3.forceSimulation(nodes.concat(linknodes))
			.force("charge", filtered_force(d3.forceManyBody()
				.strength(-100)
				.distanceMax(150), n => (!n.link && n.display) ))
			.force("linkcharge", filtered_force(d3.forceManyBody()
				.strength(-100)
				.distanceMax(40),  n => !!n.link))
			.force("midpt_align", midpoint_aligning_force)
			.force("bipartite", custom_link_force(mk_bipartite_links(linknodes)).id(l => l.id)
				.distance(l => [l.separation / STRETCH_FACTOR, 
								l.separation * STRETCH_FACTOR]).iterations(3))
			.force("nointersect", custom_collide_force()
				.iterations(3))
			// .force("center", d3.forceCenter(canvas.width / 2, canvas.height / 2).strength(0.01))
			.on("tick", ontick)
			.stop();
		simulation.alphaDecay(0.05);

		// A hypergraph carrying explicit `viz` coords has already been laid out — by
		// hand, or by gen_catalog_examples.py so it matches the dissertation figure.
		// Re-initializing destroys that. `load()` has always guarded this, but the
		// CONSTRUCTOR path could not: it calls load() while `simulation` is still
		// undefined, so the guard was skipped and this unconditional timeout fired.
		// Net effect was that the FIRST model shown was always scrambled while every
		// model loaded afterwards came up correctly — reinitialize_node_positions maps
		// x → x*10.8 + width/2, which suits d3's unit-scale defaults but sends a pinned
		// x=400 to 5040, far off-canvas, after which the forces drag it back into a
		// corner clump.
		setTimeout(function () {
			if (has_pinned_layout) {
				settle_pinned_layout();
			} else {
				reinitialize_node_positions();
			}
		}, 10);
	}
	function update_simulation() {
		if (typeof simulation != 'undefined') {
			simulation.nodes(nodes.concat(linknodes));
			simulation.force("bipartite").links(mk_bipartite_links(linknodes));
			simulation.restart();
		}
	}
	
	function renderLatexLabel(text) {
		if (!text) return '';
		const hasMath = text.includes('$') || /\\[a-zA-Z]/.test(text);
		if (hasMath && typeof katex !== 'undefined') {
			const math = text.replace(/^\$+/, '').replace(/\$+$/, '');
			try {
				return katex.renderToString(math, { throwOnError: false, displayMode: false });
			} catch(e) { /* fall through */ }
		}
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function fresh_label(prefix="p") {
		existing = links.map( l => l.label);
		i = 1;
		while(existing.includes(prefix+i)) i++;
		return prefix+i;
	}
	function fresh_node_name(prefix="X") {
		// existing = N;
		existing = nodes.map(n => n.id);
		i = 1;
		while(existing.includes(prefix+i)) i++;
		return prefix+i;
	}
	function new_link(src, tgt, label, initial_ln_pos=[undefined,undefined]) {
		ensure_multinode(src);
		ensure_multinode(tgt);
		// simulation.nodes(nodes);
		align_node_dom();
		// simulation.force("anotherlink").links(parentLinks);
		
		let lobj = linkobject([label, [src,tgt]], links.length);
		links.push(lobj);
		// simulation.force("link").links(links);
		let ln = mk_linknode(lobj);
		ln.x = initial_ln_pos[0] == undefined ? ln.x : initial_ln_pos[0];
		ln.y = initial_ln_pos[1] == undefined ? ln.y : initial_ln_pos[1];

		linknodes.push(ln);
		simulation.nodes(nodes.concat(linknodes));
		simulation.force("bipartite").links(mk_bipartite_links(linknodes));

		simulation.alpha(0.7).restart();
		
		return lobj;
	}
	function new_node(vname, x,y) {
		let ob = {
			id: vname, 
			x: x, y: y, vx: 0, vy:0,
			w : initw, h : inith,  display: true};
		nodes.push(ob);
		lookup[vname] = ob;
		align_node_dom();
		return ob;
	}
	function align_node_dom() {
		let nodedata = svgg.selectAll(".node").data(nodes, n => n.id);
		let newnodeGs = nodedata.enter()
			.append("g")
			.classed("node", true);
			// .call(simulation.drag);
		newnodeGs.append("rect").classed("nodeshape", true);
		newnodeGs.append("foreignObject").classed("label-fo", true)
			.append("xhtml:div").classed("label-html node-label", true);

		nodedata.exit().each(remove_node)
			.remove();

		nodedata = nodedata.merge(newnodeGs);
		nodedata.classed('expanded', n => n.expanded);
		nodedata.classed('anchored', n => n.anchored);
		nodedata.selectAll("rect.nodeshape")
			.attr('width', n => n.w).attr('x', n => -n.w/2)
			.attr('height', n => n.h).attr('y', n => -n.h/2)
			.attr('rx', 15);
		nodedata.selectAll("foreignObject.label-fo")
			.attr('width', n => n.w).attr('x', n => -n.w/2)
			.attr('height', n => n.h).attr('y', n => -n.h/2);
		nodedata.selectAll("div.node-label").html(n => renderLatexLabel(n.id));
		nodedata.filter( n => ! n.display).attr('display', 'none');
		
		// if (typeof simulation != 'undefined') {
		// 	simulation.nodes(nodes.concat(linknodes));
		// 	simulation.force("bipartite").links(mk_bipartite_links(linknodes));
		// 	simulation.restart();
		// }
		update_simulation();
	}
	function restyle_links() {
		let lndata = svgg.selectAll(".linknode").data(linknodes, ln => ln.link.label);
		
		let newlnGs = lndata.enter().append("g").classed("linknode", true);
		newlnGs.append("foreignObject").classed("label-fo linknode-label-fo", true)
			.append("xhtml:div").classed("label-html linknode-label", true);

		lndata.exit().remove();

		lndata = lndata.merge(newlnGs);
		lndata.attr('transform', ln => "translate("+ ln.x+","+ln.y+")")
			.classed('selected', ln => ln.link.selected);
		lndata.selectAll("foreignObject.linknode-label-fo")
			.attr('width', 120).attr('x', -60)
			.attr('height', 30).attr('y', -15);
		lndata.selectAll("div.linknode-label").html(ln => renderLatexLabel(ln.link.label));
	}
	function restyle_nodes() {
		/*** Now for somedd svgg operations. ***/
		// let nodedata = 
		svgg.selectAll(".node").data(nodes, n => n.id)
			// .attr("transform", n => "translate(" + lookup[n].x + ","+lookup[n].y +")")
			// .classed("selected", n => lookup[n].selected );
			.attr("transform", n => "translate(" + n.x + ","+ n.y +")")
			.classed("selected", n => n.selected );
	}
	function remove_node(n) {
		// console.log("removing node", n);
		for(let i = 0; i < links.length; i++) {
			l = links[i];
			// console.log("... |link ", l.label, l.source, l.target,
				// " --> remove? ",l.srcs.indexOf(n.id) >= 0 || l.tgts.indexOf(n.id) >= 0);
			// This test only works if this is the link object in a real force!!
			// if(l.source.id == n.id || l.target.id == n.id)
			// if(l.source == n.id || l.target == n.id)
			if(l.srcs.includes(n.id) || l.tgts.includes(n.id)) {
				remove_link(l);
				i--;
			}
		}
		// simulation.force("bipartite").links(mk_bipartite_links(linknodes));
		
		let multis_to_remove = [];
		// for(let i = 0; i < parentLinks.length; i++) {
		// 	l = parentLinks[i];
		// 	if(l.source.id == n.id || l.target.id == n.id) {
		// 		parentLinks.splice(i,1);
		// 
		// 		cpt_idx = l.source.components.indexOf(n.id);
		// 		l.source.components.splice(cpt_idx,1);
		// 		// if( l.source.components.length == 0)
		// 		ensure_multinode(l.source.components);
		// 		multis_to_remove.push(l.source);
		// 		i--;
		// 	}
		// }
		for(let i = 0; i < nodes.length; i++) {
			let m = nodes[i];
			if(m == n) { // might already be gone, but make sure.
				nodes.splice(i,1); i--; continue;
			}
			if(m.components) { // remove n from other multinodes, 
				// ... or more accurately, delete them and create new,
				// smaller multi-nodes.
				let idx = m.components.indexOf(n.id)
				if(idx < 0) continue;
				m.components.splice(idx,1);
				ensure_multinode(m.components);
				multis_to_remove.push(m);
			}

		}
		delete lookup[n.id];
		multis_to_remove.forEach(remove_node);
	}
	function remove_link( l ) {
		// console.log("removing link ", l)
		var index = links.indexOf(l);
		if(index >= 0) {
			links.splice(index,1);
		}
		else if(l.label != 'templink')
			console.warn("link "+l.label+" not found for removal");
		index = linknodes.findIndex(ln => ln.link == l)
		if(index >= 0) {
			linknodes.splice(index, 1);
		}
		else if(l.label != 'templink')
			console.warn("linknode corresponding to "+l.label+" not found for removal");
	}
	
	function pickN(pt) {
		for(let objn of nodes) {
			adx = Math.abs(objn.x - pt.x);
			ady = Math.abs(objn.y - pt.y);

			if(adx <  objn.w/2 && ady < objn.h/2)
				return objn;
		}
	}
	function picksL(pt, l, extra_lw) {
		context.save();
		context.lineWidth = extra_lw + (l.lw ?? 2);
		let b = context.isPointInStroke(l.path2d, pt.x, pt.y);
		context.restore();
		return b;
	}
	function pickL(pt, extra_lw=6, return_ln=false) {
		context.save();
		// for(let l of links) {
		let l;
		for(let ln of linknodes) {
			l = ln.link;
			context.lineWidth = extra_lw + (l.lw ?? 2);
			if( context.isPointInStroke(l.path2d, pt.x, pt.y) ) {
				context.restore();
				return return_ln ? ln : l;
			}
		}
		context.restore();
	}
	
	function box_select(start, end, shift) {
		let [xmin,ymin,w,h] = corners2xywh(start,end);
		let xmax = xmin + w, 
				ymax = ymin + h;
	
		finalnode = pickN(end);

			for(let objn of nodes) {
				if (objn.x >= xmin && objn.x <= xmax && objn.y >= ymin && objn.y <= ymax || objn == finalnode) {
					objn.selected = shift ? !objn.selected : true;
					// console.log((objn.selected?"":"un")+"selecting  ", objn.id, event);
					// console.log((objn.selected?"":"un")+"selecting "+objn.id);
				} else {
					// console.log(event, event.sourceEvent.ctrlKey, event.sourceEvent.shiftKey);
					if(! shift && objn.selected ) {
						// 0 -> 0 (unselected); 1 -> 2 (demote primary selection); (2 -> 1)
						objn.selected = false;
					}
				}
			}
			restyle_nodes();
			
			// essentially copy paste of above, but with a .link because the 
			// event subject is a linknode, not a link (but .selected is in link).
			for(let ln of linknodes ){
				let l = ln.link;
				if (ln.x >= xmin && ln.x <= xmax && ln.y >= ymin && ln.y <= ymax) {
					l.selected = shift ? !l.selected : true;
				} else {
					if(! shift && l.selected ) {
						l.selected = false;
					}
				}
				//... plus also this code to close under node selection
				if(l.srcs.concat(l.tgts).every(n => lookup[n].selected)){
					l.selected = true;
				}
			}
			
			restyle_links();
			ontick();
		}
	function point_select(pt, toggle) {
		let obj = pickN(pt), link = pickL(pt);
			
			if( obj || link)  {
				if( toggle )  {
					nodes.forEach( n => {if(n != obj) n.selected=false;} );
					links.forEach( l => {if(l != link) l.selected=false;} );
				}
				
				if(obj) {
					// console.log("toggling ", obj.id, e);
					obj.selected = !obj.selected;
					for(let l of links) {	
						if(l.srcs.concat(l.tgts).every(n => lookup[n].selected)) {
							l.selected = true;
						}
					}
				} 
				if(link) link.selected = !link.selected;
				
				
				restyle_nodes();
				restyle_links();
			}
	}
	function stroke(temp_link, endpt) {
		let newtgts = [], newsrcs = [];
		
		let pickobj = pdg.pickN(endpt);
		if( pickobj ) {
			// disable self-edges (for now) --- they're very annoying and easy to make by accident
			if((temp_link.srcs.length == 1) && (temp_link.srcs[0] == pickobj.id)) {
				// temp_link = null;
				console.log("aborting; no self loop");
				repaint();
				return;
			}
						
			newtgts.push(pickobj.id);
		} else { // no pick object. 
			pickl = pickL(endpt, 25);
			if(pickl) {
				if(pickl == temp_link.based_on){
					// don't do anything if based_on == final link
					temp_link.based_on.display = true;
					// temp_link = null;
					ontick(); 
					return;
				}
				newsrcs.push(...pickl.srcs);
				newtgts.push(...pickl.tgts.filter( n => !newtgts.includes(n)));
				remove_link(pickl);
			} else {
				// create new edge (Or abandon?)
				pickobj = new_node(fresh_node_name(), endpt.x, endpt.y);
				if(!newtgts.includes(pickobj.id)) newtgts.push(pickobj.id);
				
				
				// don't bother making a link if it was just a click;
				// just make the new node.
				// console.log(event, temp_link, action);
				if(temp_link.srcs.length == 0 && mag(subv(vec2(endpt), vec2(temp_link))) <= 20) {
					pdg.tick();	return;
				}
			}
		}
		// if(event.subject.link) { // event source was a link
		// 	newtgts.push(...event.subject.link.tgts.filter( n => !newtgts.includes(n)));
		// 	remove_link(event.subject.link);
		// }
		if(temp_link.based_on) { // event source was a link
			newtgts.push(...temp_link.based_on.tgts.filter( n => !newtgts.includes(n)));
			remove_link(temp_link.based_on);
		}


		// let newtgts = [pickobj.id] // do I maybe want to do this at end?
		newsrcs.push(... temp_link.srcs.filter( n => !newsrcs.includes(n)));
		new_link(newsrcs, newtgts, fresh_label(), [temp_link.x, temp_link.y]);
		simulation.alpha(0.5).alphaTarget(0).restart();
		
		pdg.tick();	
	}
	function rename_node(old_name, new_name) {
		obj = lookup[old_name];
		let replacer = nid => (nid == obj.id) ? new_name : nid;
		//TODO this will leave parentLinks in the dust...
		for(let l of links) {
			l.srcs = l.srcs.map(replacer);
			l.tgts = l.tgts.map(replacer);
			l.source = l.srcs.join(",");
			l.target = l.tgts.join(",");
		}
		delete lookup[obj.id];
		obj.id = new_name;
		lookup[new_name] = obj;
		align_node_dom();
	}	
	function delete_selection() {		
		simulation.stop();
		nodes = nodes.filter(n => !n.selected);
			// for(let i = 0; i < )
		links_to_remove = links.filter( l => l.selected);
		links_to_remove.map(remove_link);
		align_node_dom();
	}
	function select_all() {
		let all_selected = true;
		for(let s of nodes.concat(links)) {
			if(! s.selected) 
				all_selected = false;
			s.selected = true;
		}
		if(all_selected) {
			for(let s of nodes.concat(links))
				s.selected = false;
		}
		restyle_nodes();
		restyle_links();
		repaint();
	}
	
	function handle(action) {
		if(action.type == 'box-select') {
			box_select(action.start, action.end, action.shift);
		} else if( action.type == "edge-stroke") {
			stroke(action.temp_link, action.endpt);
		}
	}
	
	mk_simulation();
	
	return {
		sim : simulation,
		load : load,
		tick : ontick,
		draw : draw,
		handle: handle,
		new_node : new_node,
		new_link : new_link,
		point_select : point_select,
		rename_node : rename_node,
		select_all : select_all,
		delete_selection : delete_selection,
		update_simulation : update_simulation,
		set_edge_scores(scores) {
			for (const l of links) {
				l.inc_score = parse_score(scores[l.label]);
			}
			// Normalize the ramp against FINITE scores only — otherwise a single
			// infinite edge sends _inc_max to Infinity and every finite edge
			// collapses to t = 0 (the ramp degenerates to solid blue).
			const finite = links
				.map(l => l.inc_score)
				.filter(v => v != null && Number.isFinite(v) && v > 0);
			_inc_max = finite.length ? Math.max(...finite) : 0;
		},
		get state() {
			return current_hypergraph();
		},
		get selected_node_ids() {
			return nodes.filter( n => n.selected ).map( n => n.id );
		},
		get all_node_ids() {
			return nodes.map( n => n.id );
		},
		get sim_mode() {	return sim_mode;	},
		set sim_mode( mode ) {
			// one of 'linknodes only' or 'all'
			if(sim_mode !== mode) {
				if(mode === "linknodes only"){
					
				} else if(mode === "all") {
					// simulate();
				}
				else throw "invalid mode \""+ mode +"\"";
				sim_mode = mode;
			}
		},
		// these are sketchier
		// nodes : nodes,
		get nodes() { return nodes; },
		get linknodes() { return linknodes; },
		get links() { return links; },
		get lookup() { return lookup; },
		renderLatexLabel : renderLatexLabel,
		pickL : pickL,
		pickN : pickN,
		picksL : picksL,
		restyle_nodes  : restyle_nodes,
		restyle_links  : restyle_links,
		compute_link_shape : compute_link_shape,		
		repaint_via : function(redraw) {
			repaint = redraw
		},
		align_node_dom : align_node_dom
	}
}
