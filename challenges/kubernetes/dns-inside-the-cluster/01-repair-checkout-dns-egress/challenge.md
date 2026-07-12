---
title: "Repair Checkout DNS Egress"
sectionSlug: how-dns-itself-fails
order: 1
---

The `checkout` namespace now uses default-deny egress, and `checkout-web` cannot resolve even `kubernetes.default`. The submitted NetworkPolicy has approved identity and change metadata, but its policy contract is missing. Build narrowly scoped DNS egress so only the intended application Pods can query the cluster DNS Pods.

Your job:

1. **Preserve the approved policy identity and metadata** for `allow-dns-egress` in the `checkout` namespace.
2. **Build the caller and policy contract** for Pods labeled `app.kubernetes.io/name: checkout-web` with the exact policy type `Egress`.
3. **Define one combined DNS destination** using namespace label `kubernetes.io/metadata.name: kube-system` and Pod label `k8s-app: kube-dns`.
4. **Allow both DNS transports as separate entries** on numeric port `53`, one using `UDP` and one using `TCP`.

The grader checks the parsed policy identity, caller selector, DNS destination selectors, and both exact port rules.
