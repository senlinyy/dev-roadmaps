Revision retention belongs directly on the Deployment spec. Construct the traffic gate inside the `api` container and target the existing named port.

---

Readiness decides when the new Pod can receive Service traffic. It does not replace revision history, which preserves earlier Pod templates.
