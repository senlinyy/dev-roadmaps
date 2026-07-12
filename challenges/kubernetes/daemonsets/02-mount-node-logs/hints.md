Create the `agent` container entry, then nest its resource settings and volume mount inside it. Build the host path volume beside the containers in the Pod template spec.

---

Use the same volume name on both sides of the mount. Keep the host directory type explicit and the container-side mount read-only.
