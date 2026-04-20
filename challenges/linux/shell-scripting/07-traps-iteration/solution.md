Open vim for each script:

```bash
$ vim cleanup-demo.sh
```

Press `i` and type:

```bash
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
    echo "cleanup done"
}
trap cleanup EXIT

echo "working..."
```

Press `Esc`, then `:wq`. Next:

```bash
$ vim process-logs.sh
```

Type:

```bash
#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' file; do
    echo "Processing: ${file}"
done < <(find /var/log -name "*.log" -print0)
```

Save with `:wq`, then:

```bash
$ chmod +x cleanup-demo.sh process-logs.sh
```

The `trap cleanup EXIT` ensures the cleanup function runs regardless of how the script ends (success, failure, or interrupt). The `find -print0` + `read -d ''` combination uses null bytes as delimiters, which is the only safe way to handle filenames that contain spaces or special characters.
