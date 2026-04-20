Open vim, type the script, save, and make executable:

```bash
$ vim safe-deploy.sh
```

In vim, press `i` and type:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="devpolaris"
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
DB_HOST="${DB_HOST:?DB_HOST must be set}"

echo "Deploying $APP_NAME to $DEPLOY_ENV"
```

Press `Esc`, then `:wq` to save. Then:

```bash
$ chmod +x safe-deploy.sh
```

The `set -euo pipefail` line enables all three safety flags at once. `readonly` prevents the variable from being accidentally overwritten later. `${VAR:-default}` provides a fallback for optional settings, while `${VAR:?message}` aborts the script when a required variable is missing.
