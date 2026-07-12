The delivery contract needs two separate lists: one in the Pod spec chooses the ConfigMap source, and one on the worker container chooses where that named volume appears.

---

The volume and mount connect through the same `name` value.
