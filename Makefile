# Thin aliases over uv. uv provisions the interpreter pinned in
# .python-version, resolves dependencies, and creates .venv on first run, so
# there is no separate bootstrap step to forget or document.
#
# The --extra web flag is what pulls in fastapi/uvicorn; without it server.py
# dies at import. It lives here rather than in your muscle memory.

.PHONY: viz check examples help

help:
	@echo "make viz       run the visualization at http://localhost:8080"
	@echo "make check     verify every catalog example against the dissertation"
	@echo "make examples  regenerate examples/*.json and catalog.json"

# Serving over HTTP is required, not a preference: interface.htm fetches its
# startup model, and Score/Optimize call back into Python. Opening the file
# directly renders a dead page.
viz:
	uv run --extra web viz/server.py

check:
	uv run --extra web viz/check_examples.py

# The example JSONs are build output. Edit the generator, never the files.
examples:
	uv run --extra web viz/gen_catalog_examples.py
