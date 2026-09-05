```bash
cat missing.log | grep ERROR | wc -l
set -o pipefail
cat missing.log | grep ERROR | wc -l
printf 'pipeline_status=%s\n' "$?"
grep -qF 'deployment complete' healthy.log
printf 'marker_status=%s\n' "$?"
```

The missing-input pipeline produces a diagnostic. The readable log's absent marker is an ordinary non-match, not an input error.
