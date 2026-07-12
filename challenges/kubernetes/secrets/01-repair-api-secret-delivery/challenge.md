---
title: "Repair the API Secret Delivery"
sectionSlug: deliver-secrets-as-environment-variables
order: 1
---

The notification API Deployment has its approved image, replica identity, and HTTP port, but no credential delivery contract. Build the container environment so the approved Secret supplies only the two credentials the process needs, without placing either live value in the Deployment.

Your job:

1. **Keep the container named `api`** with its existing approved image.
2. **Build environment variable `DATABASE_URL`** from key `DATABASE_URL` in Secret `notification-api-secrets`.
3. **Build environment variable `WEBHOOK_SIGNING_KEY`** from key `WEBHOOK_SIGNING_KEY` in the same Secret.
4. **Use explicit Secret references** so the Deployment declares the credential contract without containing credential values.

The grader checks the exact parsed `secretKeyRef` contracts and approved image.
