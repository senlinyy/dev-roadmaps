---
title: "The Safety Net"
sectionSlug: the-safety-net-set--euo-pipefail
order: 5
---

Production scripts must fail loudly. The line `set -euo pipefail` after your shebang catches three categories of silent failure: unhandled errors (`-e`), unset variables (`-u`), and hidden pipeline failures (`-o pipefail`).

You start in `/home/dev`. Your job:

1. **Open vim** with `vim safe-deploy.sh` and write a script that:
   - Starts with `#!/usr/bin/env bash` and `set -euo pipefail` on the next line
   - Defines a `readonly` variable `APP_NAME` set to `"devpolaris"`
   - Uses `${DEPLOY_ENV:-staging}` to default the deploy environment
   - Uses `${DB_HOST:?DB_HOST must be set}` to require the database host
   - Ends with `echo "Deploying $APP_NAME to $DEPLOY_ENV"`
2. **Save and quit** with `:wq`, then `chmod +x safe-deploy.sh`.

The grader checks that the script contains all the required safety patterns.
