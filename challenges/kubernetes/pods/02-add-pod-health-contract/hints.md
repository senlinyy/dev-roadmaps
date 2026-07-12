All three probes belong inside the `api` container, beside `image` and `ports`.

---

Each HTTP probe uses `httpGet` with a path and numeric port.

---

The startup probe delays readiness and liveness evaluation until startup succeeds, so its threshold can cover the full warm-up window.
