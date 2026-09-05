```bash
vim backup.sh
chmod 755 backup.sh
./backup.sh "/home/dev/release source"
./backup.sh "/home/dev/release source" /home/dev/backups
```

`backup.sh` should contain:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  printf "usage: backup.sh SOURCE DESTINATION\n"
  exit 64
fi

source_dir="$1"
destination="$2"
tmp_dir=$(mktemp -d /tmp/backup.XXXXXX)

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

tar -czf "$tmp_dir/release.tar.gz" -C "$source_dir" .
mv "$tmp_dir/release.tar.gz" "$destination/release.tar.gz"
printf "backup published\n"
```

The archive becomes visible at its final path only after creation succeeds, and the EXIT trap removes the temporary directory on every completion path.
