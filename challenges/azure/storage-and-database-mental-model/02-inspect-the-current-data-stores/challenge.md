---
title: "Inspect The Current Data Stores"
sectionSlug: the-orders-api-has-several-kinds-of-data
order: 2
---

Use Azure CLI evidence to map the current data stores for `devpolaris-orders-api`. The resources to inspect are storage account `stdevpolarisordersprod` in `rg-devpolaris-storage-prod`, SQL database `sqldb-devpolaris-orders-prod` on server `sql-devpolaris-orders-prod` in `rg-devpolaris-data-prod`, Cosmos DB account `cosmos-devpolaris-orders-prod` in `rg-devpolaris-data-prod`, and disk `disk-orders-legacy-data-01` in `rg-devpolaris-data-prod`.

Your job:

1. **Inspect** the storage account that holds file-like outputs.
2. **Inspect** the SQL database that holds order records.
3. **Inspect** the Cosmos DB account for known-key data.
4. **Inspect** the managed disk used by the legacy worker.

The grader checks that you gathered evidence for all four data shapes from Azure.
