Audit the fixed temporary path before running the original script. Follow what happens when the copy fails and when the filter finds no successful build.

---

Use unique temporary-directory creation and an EXIT trap. A pipeline normally reports only its last command's status, so fail-fast settings need to cover the whole pipeline.
