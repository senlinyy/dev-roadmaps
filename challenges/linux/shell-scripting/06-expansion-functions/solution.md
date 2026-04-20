Open vim for each script, type the contents, save, and make executable:

```bash
$ vim pathutil.sh
```

Press `i` and type:

```bash
#!/usr/bin/env bash
set -euo pipefail

filepath="/var/log/myapp/server.log"
directory="${filepath%/*}"
filename="${filepath##*/}"
basename="${filename%.*}"

echo "$directory" "$filename" "$basename"
```

Press `Esc`, then `:wq`. Next:

```bash
$ vim greet.sh
```

Type:

```bash
#!/usr/bin/env bash
set -euo pipefail

greet() {
    local name="$1"
    echo "Hello, $name"
}

greet DevPolaris
```

Save with `:wq`, then:
$ chmod +x pathutil.sh greet.sh
```

`${filepath%/*}` strips the shortest match of `/*` from the end, giving the directory. `${filepath##*/}` strips the longest match of `*/` from the beginning, giving the filename. `local` inside functions prevents variable leakage to the global scope.
