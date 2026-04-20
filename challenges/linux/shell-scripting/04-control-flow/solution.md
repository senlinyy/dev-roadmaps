Open vim for each script, type the contents, and save:

```bash
$ vim check.sh
```

In vim, press `i` to enter Insert mode and type:

```bash
#!/usr/bin/env bash

if [[ -f "/etc/hostname" ]]; then
    echo "host found"
else
    echo "host missing"
fi
```

Press `Esc`, then `:wq` to save and quit. Next:

```bash
$ vim servers.sh
```

Type this script the same way:

```bash
#!/usr/bin/env bash

for server in web01 web02 web03; do
    echo "Checking ${server}..."
done
```

Save with `:wq`, then make both executable:

```bash
$ chmod +x check.sh servers.sh
```

The `[[ -f path ]]` test returns true when the file exists. The `for` loop iterates over space-separated values, assigning each to the loop variable.
