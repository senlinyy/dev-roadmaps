Build the Service as an internal-only contract, then add the selector for the current Pod template.

---

The selector must exactly match the stable label on the current Pod template and belongs beside the Service type under `spec`.

---

Create one port entry that connects all parts of the contract: its name and protocol, caller port `80`, and application listener port `3000`.
