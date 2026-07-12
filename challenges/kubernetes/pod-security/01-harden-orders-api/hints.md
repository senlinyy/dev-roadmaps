Pod-wide identity and volume ownership fields belong under the Pod template's `spec.securityContext`.

---

Container hardening belongs beside the image. The writable path needs both a container mount and a Pod-level volume with the same name.

---

Capabilities use a `drop` list, while seccomp uses a profile object with a `type`.
