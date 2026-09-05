```bash
vim show-status.sh
./show-status.sh "/home/dev/release notes/status.txt"
```

`show-status.sh` should contain:

```bash
#!/usr/bin/env bash
target="$1"
cat "$target"
```

Quoting the invocation and the variable expansion preserves the path as one argument throughout the workflow.
