---
title: "Inspect Recovery Settings"
sectionSlug: azure-sql-needs-point-in-time-thinking
order: 2
---

Use Azure CLI evidence for recovery settings in production. Inspect SQL database `sqldb-devpolaris-orders-prod`, storage account `stdevpolarisordersprod`, Cosmos container `job-status`, and file share `legacy-orders-share`.

Your job:

1. **Check** SQL short-term and long-term retention evidence.
2. **Check** Blob Storage soft delete, versioning, and lifecycle evidence.
3. **Check** Cosmos DB expiry evidence.
4. **Check** file share snapshot evidence.

The grader checks that your output includes recovery signals for each service.
