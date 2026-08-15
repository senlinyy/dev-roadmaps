1. Use `--list-hosts` with `web:&production:!canary` to prove the exclusion.
2. Inspect the canary group independently before running the playbook.
3. The final preview needs both `--check` and `--limit web-canary-01`.
