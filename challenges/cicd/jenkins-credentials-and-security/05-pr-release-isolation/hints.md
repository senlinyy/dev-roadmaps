Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

Running proposed code on a trusted release worker exposes that worker's authority. A late branch gate around publication cannot undo earlier execution.

---

Move checkout, installs, lint, unit tests and compilation onto the unprivileged Node pool. Transfer one validated package to a separate trusted publish stage gated to main and not a change request. Bind only the publisher's credential, and retain test evidence/cleanup.
