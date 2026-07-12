Create one `resources` block on the container inside the Pod template, not on the Deployment or Pod spec.

---

Requests carry the scheduler's planning values. Limits carry the runtime ceilings.

---

Keep CPU and memory quantities as YAML strings when needed so their Kubernetes units remain exact.
