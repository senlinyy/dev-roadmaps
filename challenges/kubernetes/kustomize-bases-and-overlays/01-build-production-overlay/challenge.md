---
title: "Build the Orders Production Overlay"
sectionSlug: add-a-production-overlay
order: 1
---

The orders API has approved Deployment and Service manifests, but neither directory is buildable and production has no controlled overrides. Complete the two Kustomize files so reviewers can trace production back to the shared base.

Your job:

1. **List both shared manifests** in `k8s/base/kustomization.yaml` using the Kustomize v1beta1 API and `Kustomization` kind.
2. **Import only `../../base`** from the production overlay and target namespace `devpolaris-prod`.
3. **Replace the orders API image tag** with approved release `2026.06.16.1` while keeping the repository unchanged.
4. **Scale Deployment `orders-api`** to exactly `3` replicas.

The grader checks both parsed Kustomize files, including exact resource and override list sizes.
