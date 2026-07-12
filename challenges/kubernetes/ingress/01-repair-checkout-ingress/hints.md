Build the missing `spec` as three contracts: controller ownership, TLS termination, and HTTP routing.

---

Nest the path inside the host's HTTP rule, then connect its backend to the Service and named port.

---

TLS is a separate list under `spec`. Its host must match the public rule host, and its Secret is selected by name.
