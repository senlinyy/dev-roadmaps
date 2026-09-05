```bash
vim process-logs.sh
./process-logs.sh
```

`process-logs.sh` should contain:

```bash
#!/usr/bin/env bash
find /var/log/orders -type f -print0 | while IFS= read -r -d '' file; do
  printf "%s\n" "$file"
done
```

The null separator preserves every pathname as data, and the quoted expansion passes each complete path to `printf`.
