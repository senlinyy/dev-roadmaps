---
title: "Validate Runtime Configuration"
sectionSlug: plain-configuration-and-startup-validation
order: 2
---

Implement loadRuntimeConfig for orders-api. Require production NODE_ENV, a valid positive PORT, the database URL, and the payments token. Return a typed configuration object for the application, but expose only a safe summary for startup logging. Invalid or missing values must fail startup before the process listens for traffic. The tests verify safe logging and several failure paths.
