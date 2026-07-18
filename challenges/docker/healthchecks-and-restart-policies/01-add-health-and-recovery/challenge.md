---
title: "Add Health and Recovery Contracts"
sectionSlug: compose-turns-health-into-startup-order
order: 1
---

The payments API starts before PostgreSQL is ready and neither service has an explicit recovery policy. Add health and restart contracts without changing the images.

Your job:

1. **Give `db` a CMD-SHELL health check** using `pg_isready -U postgres`.
2. **Use a 5-second interval, 3-second timeout, and 5 retries**.
3. **Make `api` wait for healthy `db`**.
4. **Set both services to `restart: unless-stopped`**.

The grader checks the complete database health check, dependency condition, and both restart policies.
