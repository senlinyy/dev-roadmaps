```bash
cat deploy.sh
vim deploy.sh
```

Replace the buffer with:

```bash
#!/usr/bin/env bash
set -euo pipefail
input="${1:?input required}"
tmp_dir=$(mktemp -d /tmp/deploy.XXXXXX)
trap 'rm -rf "$tmp_dir"' EXIT
cp "$input" "$tmp_dir/output.log"
grep "^SUCCESS " "$tmp_dir/output.log" | tail -n 1
printf "deployed\n"
```

Save and quit, then run:

```bash
./deploy.sh "release build.log"
./deploy.sh failed.log
./deploy.sh missing.log
find /tmp -name 'deploy.*'
```
