# Trend queries — what the trend scanner searches

Read by `scan_trends` (core/trends.mjs → workshop/trends.py; `readQueries` takes the `- ` lines under **Queries**, 100 characters at most each, the first 20 only). Edit freely: one query per line, starting with `- `.
YouTube relevance search only (the search-by-date mode is broken in this yt-dlp), Shorts uploaded this week or this month (two freshness passes, brand/studio.md §8b).
Max 20 queries. Default: 20 queries x 20 results, 15 channel tabs, up to 70 full fetches, target 40 rows, 5-8 minutes (never over 10).
Empty on purpose: the queries are written for YOUR show during the first run (CLAUDE.md, "First run"), 10 to 20 lines.
A concept may bring its own list in `concept/<id>/trend-queries.md` (planned; not read by the code yet).
Keep a few seasonal lines at the end and swap them when the season passes.

## Queries
