---
title: "Add Module Inputs"
sectionSlug: extracting-one-private-bucket-module
order: 2
---

The private bucket module is missing part of its public contract. Add caller-facing inputs that make environment, ownership, and versioning choices explicit without pushing raw provider details back to every root module.

Your job:

1. **Declare the environment input** as a string and reject values outside dev, staging, and prod.
2. **Declare the owner input** with a safe platform default.
3. **Declare the versioning toggle** as a boolean with a conservative default.
4. **Keep descriptions useful for module callers** who will read this file during review.

The grader checks the variable contract in HCL.
