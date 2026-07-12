Create the `postgres` container entry, then nest its ports, environment variables, and volume mounts inside it. Keep the Secret values indirect through `valueFrom`.

---

The mount name must exactly match the existing volume claim template name. The Secret references each need a Secret name and their own key.
