---
title: "Reason About systemd Dependencies and Ordering"
sectionSlug: dependencies-ordering-and-targets
order: 3
kind: quiz
---

`Requires=`, `Wants=`, `After=`, and `Before=` are how systemd encodes the difference between *needs* and *wishes*, and between *ordering* and *requirement*. Mixing them up is the most common reason a service either fails to start at boot or refuses to come up after a dependency restarts.

This quiz puts you in front of unit fragments and asks what would actually happen. Pick the answer that an SRE would defend during a startup-order incident review.
