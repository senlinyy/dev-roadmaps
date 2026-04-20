Run `vim safe-deploy.sh`, press `i` for Insert mode, type the script, then `Esc` and `:wq` to save. The first two lines should be the shebang and `set -euo pipefail`.

---

For `readonly`, the syntax is `readonly APP_NAME="devpolaris"`. For default values: `DEPLOY_ENV="${DEPLOY_ENV:-staging}"`. For required values: `DB_HOST="${DB_HOST:?DB_HOST must be set}"`. Do not forget to `chmod +x` at the end.
