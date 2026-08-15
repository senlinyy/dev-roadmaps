---
title: "Author the Runtime Reader Role"
sectionSlug: role-a-bundle-of-permissions
order: 2
---

Complete the custom role definition used by incident responders. It must be GA, allow only `run.services.get`, `run.services.list`, and `logging.logEntries.list`, and must not include permission to change IAM policies, deploy services, or read secret payloads. Use the title `Orders Runtime Reader`.

The grader parses the permission list and rejects broader or additional permissions.
