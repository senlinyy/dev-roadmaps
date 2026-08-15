Read `gateway.yaml` for the exact Gateway identity, namespace, and listener name. `parentRefs` belongs directly under the HTTPRoute spec.

---

Hostnames and routing rules are separate parts of `spec`. Inside a rule, a path matcher needs both its matching behavior and path value.

---

Place the backend reference in the same rule as the request match. Read `service.yaml` and target the stable Service port exposed to callers, not a container port.
