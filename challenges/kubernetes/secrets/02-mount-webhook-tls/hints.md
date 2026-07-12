The delivery contract needs a Pod-level volume for the Secret source and selected key mappings, plus a container-level mount for the destination directory.

---

Each `items` entry maps a Secret `key` to the filename in `path`. The container mount then chooses the parent directory.
