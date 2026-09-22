---
"@fission-ai/openspec": minor
---

### New Features

- **Change dependency metadata** — `.openspec.yaml` now supports an optional `depends_on` array naming other active changes this one builds on. `openspec new change --depends-on <name>[,<name>...]` validates the list against currently active changes; `openspec validate` always checks `depends_on` for unresolved names, self-references, and cycles among active changes, and gains an opt-in `--check-dependencies` flag that suggests a dependency for changes sharing a capability path with no declared relationship. `openspec list` shows a "Blocked by" column (and raw `depends_on` in `--json`) for changes with an active dependency.
