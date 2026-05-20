---
title: "Runtime Security"
description: "Detect suspicious pod behavior after deployment and connect signals back to Kubernetes context."
overview: "Runtime security watches what containers do after they start. This article explains process, file, network, and Kubernetes signals, then shows how to turn alerts into useful investigation evidence."
tags: ["runtime", "detection", "pods"]
order: 6
id: article-devsecops-kubernetes-security-runtime-security
---

## Table of Contents

1. [What Runtime Security Watches](#what-runtime-security-watches)
2. [Expected Behavior](#expected-behavior)
3. [Signals](#signals)
4. [Alert Evidence](#alert-evidence)
5. [Response](#response)
6. [Putting It All Together](#putting-it-all-together)

## What Runtime Security Watches

Runtime security watches behavior after a workload starts. Earlier controls decide what should be allowed. Runtime signals show what is actually happening.

For `devpolaris-orders`, suspicious behavior might include:

- an unexpected shell process
- writes to unusual paths
- network calls to unknown destinations
- a process trying to read service account tokens
- privilege escalation attempts
- sudden crypto-mining-like CPU patterns

The goal is not to alert on every system call. The goal is to detect behavior that does not match the workload's job.

## Expected Behavior

Start with what normal looks like.

```text
Service: orders-api
Expected process: node dist/server.js
Expected ports: 8080
Expected writes: /tmp only
Expected outbound: database, DNS, payment API
Expected Kubernetes API access: none
```

This baseline gives runtime alerts context. If the container starts `/bin/sh`, that is unusual. If it writes to `/tmp`, that may be normal. If it tries to call the Kubernetes API and the app has no reason to do so, investigate.

## Signals

Runtime tools may collect process, file, network, and Kubernetes context.

| Signal | Example | Why it matters |
|--------|---------|----------------|
| Process | `/bin/sh` started inside app container | May indicate command execution |
| File | write to `/app/server.js` | Runtime code modification |
| Network | connection to unknown IP | Possible exfiltration or callback |
| Kubernetes | service account token read | Possible API access attempt |
| Resource | CPU spike with mining-like process | Abuse of compute |

The Kubernetes context is important. An alert should include namespace, pod, container, image digest, service account, and node when possible.

## Alert Evidence

A useful alert looks like this:

```text
Alert: unexpected shell in container
Namespace: orders-prod
Pod: orders-api-6d9f4b6c7c-j2p8l
Container: orders-api
Image: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Process: /bin/sh
Parent: node
User: 1000
Service account: orders-api
First seen: 2026-05-19T13:04Z
```

This alert gives an investigator a starting point. The image digest connects to release evidence. The service account connects to RBAC. The process and parent describe behavior. The namespace and pod locate the workload.

## Response

Runtime response should preserve evidence before destroying it when possible.

```text
1. Confirm the pod, image digest, and release version.
2. Capture logs, process details, and network signals.
3. Check whether the behavior matches a deploy or debug session.
4. Isolate or restart the workload if risk is active.
5. Review RBAC, secrets, network policy, and admission gaps.
6. Create follow-up work from the root cause.
```

The order may change during a high-severity incident, but the principle stays: connect the runtime signal back to the delivery and Kubernetes controls that should have limited it.

## Putting It All Together

Runtime security is the feedback loop after deployment. It watches the behavior that static review, image scanning, pod security, network policy, secrets, and admission controls tried to shape.

For `devpolaris-orders`, useful runtime alerts include Kubernetes context, image digest, service account, process, file, network, and time. Response connects the signal back to release evidence and the controls that should reduce the next incident.

---

**References**

- [Kubernetes audit logging](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) - Kubernetes documents audit records for API activity.
- [Falco documentation](https://falco.org/docs/) - Falco documents runtime threat detection for containers and Kubernetes.
- [Kubernetes security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Kubernetes documents the runtime settings that many runtime alerts relate back to.
