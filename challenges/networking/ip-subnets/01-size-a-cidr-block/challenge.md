---
title: "Size a CIDR Block from a Real Capacity Request"
sectionSlug: cidr-notation-slicing-the-address-space
order: 1
kind: quiz
---

CIDR math is the difference between *we have room for the next deployment* and *we ran out of IPs at 03:00 and the autoscaler is paging*. The math itself is simple — pick the prefix length whose host count covers what you need — but the practical edges (cloud reserved IPs, route table limits, growth headroom) are where teams get burned.

This quiz puts you in front of capacity decisions. Pick the answer that you would defend in an architecture review.
