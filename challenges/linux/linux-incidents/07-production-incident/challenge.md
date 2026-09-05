---
title: "Production Incident Capstone"
order: 7
---

The API stopped responding after deployment. You start in `/home/dev` with permission to repair and restart `api`. The production contract is port `8080`, environment `production`, and authentication enabled.

Your job:

1. **Investigate storage, the failed service, its execution identity, and its journal.** Follow the evidence instead of assuming the first clue is the whole incident.
2. **Inspect file metadata and run `/srv/api/check-config.sh` as the service user.** Capture a failing validation before repair and a successful validation afterward. Do not edit the validator.
3. **Repair the saved configuration and its access.** Keep `root` ownership and owner read/write access, grant the service group read-only access, and deny everyone else. Preserve production mode and authentication.
4. **Restart and verify `api`** only after validation succeeds.

The grader checks diagnosis, both validator outcomes, least-privilege access, the current saved configuration, and a verified restart. JSON checks, storage, and service behavior are bounded simulations, with no real network or systemd.
