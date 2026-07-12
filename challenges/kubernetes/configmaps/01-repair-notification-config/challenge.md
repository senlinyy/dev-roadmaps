---
title: "Repair the Notification API ConfigMap"
sectionSlug: runtime-settings-outside-the-image
order: 1
---

The production notification API is being promoted with the same tested image used in staging. Its approved ConfigMap identity and ownership labels are already present, but the runtime data contract has not been authored. Build that contract so the production namespace supplies the approved plain configuration.

Your job:

1. **Keep the approved ConfigMap identity** named `notification-api-config` in namespace `customer-notifications`.
2. **Build the plain runtime settings block** for the notification API without adding credentials to the object.
3. **Provide `LOG_LEVEL` as the string `info`** and `REQUEST_TIMEOUT_MS` as the string `2500`.
4. **Provide `EMAIL_PROVIDER_URL`** as `http://email-gateway.customer-notifications.svc.cluster.local:8080`.

The grader checks the parsed ConfigMap identity and exact data contract.
