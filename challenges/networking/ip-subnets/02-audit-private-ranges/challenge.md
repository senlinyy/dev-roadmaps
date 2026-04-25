---
title: "Reject the Public CIDR Hiding in a VPC Plan"
sectionSlug: private-vs-public-ranges
order: 2
kind: quiz
---

RFC 1918 carves out exactly three blocks of address space that routers on the public internet are required *not* to forward. Anything outside those blocks is publicly routable, which means using it inside a VPC is a recipe for either NAT collisions, packets escaping to the internet, or operations teams asking *who owns this IP?*.

This quiz puts you in front of CIDR plans, ranges, and routing edge cases. Pick the answer that survives a network review at a real company.
