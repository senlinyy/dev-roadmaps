```bash
vim stage-release.sh
./stage-release.sh
```

`stage-release.sh` should contain:

```bash
#!/usr/bin/env bash
set -e

tmp_dir=$(mktemp -d /tmp/release.XXXXXX)
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

printf "%s\n" "$tmp_dir"
```

`mktemp` avoids collisions, and the EXIT trap applies one cleanup path to normal completion and failures.
