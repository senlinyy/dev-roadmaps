Keep the approved metadata and external traffic policy intact. Exposure type, backend selection, and the listener are separate children of `spec`.

---

Build one port item that gives the listener a stable name, publishes a numeric port, and targets the Pod's named port.

---

The finished listener should not request a particular port number on every node.
