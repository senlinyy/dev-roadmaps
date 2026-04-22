The TTL is the second column of the A-record row, in seconds. The runbook marks each step as `DONE`, `SKIPPED`, or `PENDING`. The cache survey lists each resolver alongside the IP it currently returns; counting matches for the old IP tells you how many are still stale.

---

`grep -c PATTERN file` returns just the count, no surrounding lines. Use it to get the stale-resolver number directly.
