Begin with evidence from identity, every pathname component, and the final object's ACL. Do not assume the last file is the failing layer.

---

The final file and release directories already grant the `app` group what it needs. Find the first parent where group execute disappears.

---

Repair that one parent with owner full access and group read plus traversal, verify as `app`, then create the proof as `deploy` so setgid inheritance remains observable.
