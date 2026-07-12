Start by rebuilding the Deployment spec around the replica count and stable identity shared by its selector and Pod template labels.

---

Readiness belongs on the `api` container and can target the existing named port instead of repeating its number.

---

The rollout strategy is a sibling of `replicas`, `selector`, and `template` inside the Deployment spec.
