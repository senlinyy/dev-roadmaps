---
title: "Reference Vaulted Secret"
sectionSlug: "encrypted-files-and-encrypted-variables"
order: 1
---

The production token is still sitting in a readable group vars file. Split the public reference from the secret value so the playbook can use a vaulted variable without exposing the token in normal review.

Your job:

1. **Make the public variable reference** the vaulted token variable.
2. **Define the vaulted token variable** in the Vault-managed file.
3. **Remove the readable production token** from the public vars file.

The grader checks the variable files, not a prose explanation.
