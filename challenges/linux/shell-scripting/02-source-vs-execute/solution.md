```bash
DEPLOY_ENV=staging
bash env.sh
printf "%s\n" "$DEPLOY_ENV"
source env.sh
printf "%s\n" "$DEPLOY_ENV"
```

The child process leaves the parent at `staging`; sourcing evaluates the assignments in the current shell and changes it to `production`.
