const test = require('node:test');
const assert = require('node:assert/strict');
const createEditHistory = require('../edit-history.js');

function graph(name, selected = false) {
	return {
		nodes: [name], hedges: {}, cpds: undefined,
		viz: { nodes: { [name]: { x: 10, y: 20, selected } }, links: [] },
	};
}

test('undo restores the previous graph edit, repeatedly', () => {
	const history = createEditHistory();
	history.reset(graph('A'));
	history.record(graph('B'));
	history.record(graph('C'));
	assert.deepEqual(history.undo().nodes, ['B']);
	assert.deepEqual(history.undo().nodes, ['A']);
	assert.equal(history.undo(), null);
});

test('selection-only changes are not edits', () => {
	const history = createEditHistory();
	history.reset(graph('A'));
	assert.equal(history.record(graph('A', true)), false);
	assert.equal(history.undo(), null);
});

test('history snapshots cannot be mutated by later CPD edits', () => {
	const history = createEditHistory();
	const first = graph('A');
	first.cpds = { e: { a: { b: 0.2 } } };
	history.reset(first);
	first.cpds.e.a.b = 0.8;
	history.record(first);
	assert.equal(history.undo().cpds.e.a.b, 0.2);
});

test('loading another model clears prior undo steps', () => {
	const history = createEditHistory();
	history.reset(graph('A'));
	history.record(graph('B'));
	history.reset(graph('X'));
	assert.equal(history.undo(), null);
});
