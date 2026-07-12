---
title: "Repair the Notification API Resources"
sectionSlug: the-resource-block
order: 1
---

The notification API Deployment has its approved rollout and container context, but no resource contract. Build the `api` container hierarchy that gives the scheduler realistic reservations and gives the runtime bounded headroom for expected bursts.

Your job:

1. **Build scheduler requests** that reserve `300m` CPU and `384Mi` memory.
2. **Build runtime limits** with a CPU ceiling of `1` core.
3. **Set the memory ceiling to `768Mi`** so expected preview traffic has measured headroom.
4. **Keep the Deployment named `notification-api`** in the `notifications` namespace and leave its image unchanged.

The grader checks the parsed Deployment identity, image, and exact request and limit values.
