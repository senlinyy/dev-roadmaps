Use a label selector when listing Pods so the evidence stays scoped to the orders API. The Pod with zero ready containers and six restarts is the incident target.

---

Describe that exact Pod to connect the restart count to Kubernetes' BackOff event.

---

Current logs come from the replacement process. Add `--previous` when reading container `api` to recover the output from the process that exited.
