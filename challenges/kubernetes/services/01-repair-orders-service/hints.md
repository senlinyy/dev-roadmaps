Read the labels under `deployment.yaml` at `spec.template.metadata.labels`. A Service selector is a mapping under `spec.selector`, not a reference to the Deployment name.

---

Treat selection and port publication as separate parts of the Service contract. The selector must require both workload labels.

---

The caller-facing port stays numeric while `targetPort` refers to the container port by name. Keep the ports list to one item.
