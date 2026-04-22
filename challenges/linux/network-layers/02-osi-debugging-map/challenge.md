---
title: "Route Incident Snapshots to the Right OSI Layer"
sectionSlug: the-osi-model-as-a-debugging-map
order: 2
---

Three incident snapshots were dropped into `/var/log/incidents/` before the last on-call handed the queue to you. You need to decide which OSI layer each one belongs to *without* a crib sheet: a refused SSH connection, a dead switch port showing `NO-CARRIER`, and a same-subnet neighbor lookup that ends in `FAILED`. Record the routing decision so the next engineer knows where to start.

You start in `/home/dev`. Your job:

1. **Review the three incident snapshots** in `/var/log/incidents/` and identify the key symptom in each one.
2. **Classify each incident by OSI layer** using the article's debugging model.
3. **Write `/home/dev/reports/osi-routing.note`** with one line per incident using the format `incident-name Layer N`.
4. **Print the completed routing note** so the handoff is visible in the terminal history.

The grader requires you to use `cat` and `echo`, and checks that your routing note maps `bastion-ssh` to `Layer 4`, `edge-link` to `Layer 1`, and `db-neighbor` to `Layer 2`.
