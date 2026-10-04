# data/

This folder is used at runtime.

- `streamwatch.db` — SQLite database (auto-created, not committed)
- `reviews.jsonl`  — Human review log (auto-created, not committed)
- `demo_cache/`    — Pre-cached USGS API responses for demo fallback

The `.gitignore` excludes runtime files from version control.
Place any pre-fetched demo JSON files in `demo_cache/` manually.
