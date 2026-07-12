---
title: "Fix the Dev Root Module"
sectionSlug: what-lives-in-an-environment-folder
order: 1
---

The development environment folder should be a deployable root module. It should choose the shared module source and supply dev-sized values instead of copying production wiring.

Your job:

1. **Call the orders service module** from the dev root.
2. **Pass development bucket names** for invoice and export storage.
3. **Use dev capacity and safety settings** that match a low-risk environment.
4. **Keep environment-specific values in this root** instead of changing the shared module.

The grader checks the dev root module call in HCL.
