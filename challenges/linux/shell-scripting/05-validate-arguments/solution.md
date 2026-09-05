```bash
vim promote.sh
./promote.sh "release 42"
./promote.sh "release 42" "api blue" "worker green"
```

`promote.sh` should contain:

```bash
#!/usr/bin/env bash
if [[ "$#" -lt 2 ]]; then
  printf "usage: promote.sh LABEL TARGET...\n"
  exit 64
fi

label="$1"
shift
printf "label=%s\n" "$label"
for target in "$@"; do
  printf "target=%s\n" "$target"
done
```

`shift` removes the label, and `"$@"` preserves each remaining argument exactly as supplied.
