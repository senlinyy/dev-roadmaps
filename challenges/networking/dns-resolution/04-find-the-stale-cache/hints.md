The TTL is the second column of the A-record row, in seconds. The runbook marks each step as `DONE`, `SKIPPED`, or `PENDING`. The cache survey lists each resolver alongside the IP it currently returns; counting matches for the old IP tells you how many are still stale.

---

Pipe the old-IP matches into `wc -l` to get the stale-resolver number directly while keeping the matching evidence available if you need to inspect it first.
