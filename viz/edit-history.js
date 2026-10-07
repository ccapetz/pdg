// A bounded history of serializable PDG states. Selection is UI state, not an edit.
function createEditHistory(limit = 50) {
	let entries = [];

	function snapshot(state) {
		const json = JSON.stringify(state);
		const comparable = JSON.parse(json);
		for (const node of Object.values(comparable.viz?.nodes || {})) delete node.selected;
		for (const [, link] of comparable.viz?.links || []) delete link.selected;
		return { json, key: JSON.stringify(comparable) };
	}

	return {
		reset(state) { entries = [snapshot(state)]; },
		record(state) {
			const next = snapshot(state);
			if (entries.at(-1)?.key === next.key) return false;
			entries.push(next);
			if (entries.length > limit) entries.shift();
			return true;
		},
		undo() {
			if (entries.length < 2) return null;
			entries.pop();
			return JSON.parse(entries.at(-1).json);
		},
	};
}

if (typeof module !== 'undefined') module.exports = createEditHistory;
