Start with `kubectl config current-context`. The remaining commands need both `--context notifications-prod` and `--namespace notifications-prod` so no read depends on the current staging defaults.

---

List Pods with `-l app=notification-api`. The row with zero ready containers and four restarts identifies the Pod whose logs need inspection.

---

Use `kubectl logs POD -c api --tail 3` with the same explicit context and namespace flags.
