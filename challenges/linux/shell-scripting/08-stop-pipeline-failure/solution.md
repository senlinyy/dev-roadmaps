```bash
vim publish.sh
./publish.sh
```

`publish.sh` should contain:

```bash
#!/usr/bin/env bash
set -euo pipefail

false | true
touch /home/dev/release.published
printf "published\n"
```

`pipefail` exposes the first segment's failure, and `-e` stops the script before it creates the marker.
