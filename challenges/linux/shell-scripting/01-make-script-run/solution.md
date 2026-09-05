```bash
vim release-check.sh
chmod 755 release-check.sh
./release-check.sh
```

`release-check.sh` should contain:

```bash
#!/usr/bin/env bash
printf "release check passed\n"
```

The shebang selects Bash, while mode `755` makes direct execution possible.
