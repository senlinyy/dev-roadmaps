Leave the approved identity, labels, annotations, and session affinity intact. The missing contract belongs alongside session affinity under `spec`.

---

Treat selection and port publication as separate parts of the Service contract. The selector must require both workload labels.

---

The caller-facing port can stay numeric while `targetPort` refers to the container port by name.
