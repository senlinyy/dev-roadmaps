---
title: "Diagnose Firewall Rule-Order and Stateful Failure Modes"
sectionSlug: firewall-failure-modes
order: 5
---

Most firewall outages are not "the firewall is down." They are *subtle* — a rule in the wrong order, a stateful timeout you forgot about, a NAT rule shadowing a return path, a Security Group whose match logic you misremembered. Each scenario below describes a failure that an on-call engineer is looking at right now.

For each one, pick the failure mode that best explains the symptoms. Look for evidence about *match order*, *stateful tracking*, and *which direction* of the flow is being broken.
