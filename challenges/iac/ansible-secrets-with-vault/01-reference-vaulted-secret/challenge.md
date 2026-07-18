---
title: "Reference Vaulted Secret"
sectionSlug: "encrypted-files-and-encrypted-variables"
order: 1
---

The production token is still sitting in a readable group vars file. An encrypted Vault file is already present as read-only context. Repair the public variable boundary so the playbook uses that vaulted value without exposing a token in normal review.

Your job:

1. **Make the public variable reference** the vaulted token variable.
2. **Keep the non-secret port setting** unchanged.
3. **Remove the readable production token** from the public vars file without editing the encrypted Vault artifact.

The grader checks the variable files, not a prose explanation.
