Rollout pacing and history settings belong directly under the Deployment spec. Readiness and resources belong inside the `api` container in the Pod template.

---

Use the named `http` port for the readiness probe so the health contract follows the container port identity.
