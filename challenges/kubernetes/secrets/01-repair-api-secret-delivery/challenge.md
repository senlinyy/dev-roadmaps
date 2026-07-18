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
4. **Use only these two explicit Secret references** with no literal values or bulk `envFrom` import.

The grader checks the exact parsed `secretKeyRef` contracts, approved image, and absence of broader or literal credential delivery.
