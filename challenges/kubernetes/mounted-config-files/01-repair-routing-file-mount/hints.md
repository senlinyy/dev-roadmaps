Author the whole path from ConfigMap source through Pod volume to container mount. The source key and projected filename are separate fields.

---

Use `items` to select and rename the key. The file mode belongs to the ConfigMap volume source, while the read-only flag belongs to the container mount.
