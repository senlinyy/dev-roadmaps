---
title: "Build the Production Service"
sectionSlug: identity-secrets-and-logs
order: 2
---

Complete the Cloud Run service contract for `orders-api`. Use image `europe-west2-docker.pkg.dev/devpolaris-prod/apps/orders-api:2026.08.1`, runtime identity `orders-runtime@devpolaris-prod.iam.gserviceaccount.com`, container port 8080, and two to ten instances. Inject `PAYMENTS_API_TOKEN` from Secret Manager secret `payments-api-token` version `latest`, and do not store a literal secret value.

The grader checks the native service YAML and the identity, scaling, port, and secret relationships.
