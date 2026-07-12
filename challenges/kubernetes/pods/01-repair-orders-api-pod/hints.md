Start with `metadata`. Namespace and labels belong beside the Pod name.

---

Construct separate `ports` and `env` arrays inside the first item under `spec.containers`. Each array needs an object with the literal required by the release contract.

---

The restart policy belongs to the Pod spec, not inside the container.
