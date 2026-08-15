---
title: "Build a Batched Rollout"
sectionSlug: health-checks-between-batches
order: 1
revision: 2
---

Turn an all-at-once deployment into a two-host rolling update. Remove each batch from the load balancer, deploy and restart the service, verify local health, and add the hosts back only after success.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
