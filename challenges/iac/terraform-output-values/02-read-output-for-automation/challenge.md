---
title: "Read an Output for Automation"
sectionSlug: humans-and-scripts-using-outputs
order: 2
revision: 2
---

The stack has already been initialized and applied in `/workspace`. Retrieve only the raw `orders_endpoint` value so a deployment script can consume it without Terraform display quotes.

Your job:

1. **Read** the named output with raw formatting.
2. **Confirm** the exact endpoint is `https://orders-prod.eu-west-2.elb.amazonaws.com`.
3. **Do** not inspect or edit state files directly.

The grader checks the command workflow and resulting Terraform state, not a prose explanation.
