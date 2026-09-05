```bash
head -n 2 transfers.log
awk '$2 > 100 { printf "%s %d\n", $1, $2 }' transfers.log
awk 'BEGIN { total = 0 } { total += $2 } END { printf "records=%d total_mb=%d\n", NR, total }' transfers.log
awk '{ usage[$1] += $2 } END { for (user in usage) print user, usage[user] }' transfers.log | sort
```

The strict comparison excludes Bob's 100 MB transfer. The whole-file total includes every transfer, while the per-user aggregation combines Alice's two records.
