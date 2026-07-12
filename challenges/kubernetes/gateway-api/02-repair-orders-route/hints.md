Start the route contract by creating a parent reference that identifies the shared Gateway, its namespace, and its intended listener.

---

Hostnames and routing rules are separate parts of `spec`. Inside a rule, a path matcher needs both its matching behavior and path value.

---

Place the backend reference in the same rule as the request match. It targets the stable Service port exposed to callers, not the container's target port.
