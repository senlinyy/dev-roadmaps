---
title: "Make the Orders API Drain-Ready"
sectionSlug: make-devpolaris-orders-api-drain-ready
order: 1
---

A node upgrade will voluntarily evict application Pods. Build the orders API Deployment and its PodDisruptionBudget together so the workload has enough replicas, a real readiness gate, and a disruption selector that protects the exact Pods created by the controller.

Your job:

1. **Build Deployment `devpolaris-orders-api`** in namespace `orders` with `3` replicas and matching selector and Pod template label `app.kubernetes.io/name: devpolaris-orders-api`.
2. **Define container `api`** from image `ghcr.io/devpolaris/orders-api:2026.08.1`, with named port `http` at `8080`.
3. **Add an HTTP readiness probe** for `/readyz` through named port `http`, with period `5` seconds and failure threshold `3`.
4. **Build PodDisruptionBudget `devpolaris-orders-api`** in namespace `orders`, selecting the same Pod label and requiring `minAvailable: 2`.

The grader parses both resources, proves both selectors match the Pod template, and checks the complete availability contract needed before a node drain.
