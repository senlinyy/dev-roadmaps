---
title: "Author Slot-Safe Release Settings"
sectionSlug: deployment-slots
order: 3
---

Prepare the App Service settings payload used for the staging slot. `APP_ENV` must remain a slot-specific value of `staging`, `PAYMENTS_API_URL` must use `https://payments.internal`, and `DB_PASSWORD` must be a Key Vault reference to `https://kv-orders-prod.vault.azure.net/secrets/db-password`. Mark the environment and database secret as slot settings so a swap does not move them into production.

The grader parses the settings array and rejects duplicate or unscoped values.
