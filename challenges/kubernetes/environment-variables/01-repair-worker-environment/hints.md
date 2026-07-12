Classify each required process variable before authoring the container environment list: ordinary configuration, sensitive data, or Kubernetes-assigned metadata.

---

Each entry needs its process-facing name and a `valueFrom` reference whose nested source type matches that classification.
