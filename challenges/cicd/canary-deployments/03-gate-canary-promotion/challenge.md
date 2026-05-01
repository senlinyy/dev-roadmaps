---
title: "Gate Canary Promotion"
sectionSlug: promoting-the-canary
order: 3
---

The canary workflow checks CodeDeploy success before it watches the first traffic slice. Promotion should wait for the canary window to prove the new release behaves close to stable.

Your task:

1. **Create the canary deployment** from the tested image digest.
2. **Watch the canary window** before checking final CodeDeploy success.
3. **Check CodeDeploy success** only after the watch step passes.
4. **Serialize canaries** for the production service.

The grader checks the production environment, concurrency, and step order.

