---
title: "Secret Manager and Runtime Secrets"
description: "Store runtime secrets in Google Cloud Secret Manager, grant narrow access, rotate versions, use aliases carefully, and protect old versions before destruction."
overview: "A runtime secret is a sensitive value your app needs after it starts, such as a payment API key, webhook signing key, or database password. Secret Manager gives that value a managed, versioned, IAM-protected home."
tags: ["gcp", "secret-manager", "runtime-secrets", "rotation"]
order: 3
id: article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics
aliases:
  - secret-manager-and-encryption-basics
  - cloud-providers/gcp/identity-security/secret-manager-and-encryption-basics.md
---

## Table of Contents

1. [What Is the Runtime Secret Problem?](#what-is-the-runtime-secret-problem)
2. [What Does a Secret Version Identify?](#what-does-a-secret-version-identify)
3. [Who May Retrieve the Secret Payload?](#who-may-retrieve-the-secret-payload)
4. [How Do You Rotate a Secret Without Breaking Consumers?](#how-do-you-rotate-a-secret-without-breaking-consumers)
5. [When Should a Workload Use a Version Number or an Alias?](#when-should-a-workload-use-a-version-number-or-an-alias)
6. [How Does Delayed Destruction Create a Recovery Window?](#how-does-delayed-destruction-create-a-recovery-window)
7. [How Do These Ideas Map to AWS Secrets Manager?](#how-do-these-ideas-map-to-aws-secrets-manager)
8. [How Do You Prove Secret Use Without Printing the Payload?](#how-do-you-prove-secret-use-without-printing-the-payload)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An app often needs one private value after it starts. A payment service needs a provider API key. A webhook receiver needs a signing key. A backend needs a database password. Those values are small strings, yet they carry real access to money movement, customer data, or internal systems.

Putting those values in source code, Docker images, Terraform outputs, Slack messages, or plain environment files creates a recovery problem. Anyone who can see the file may see the value, and rotation requires hunting down every copy. A managed secret store gives you one place to control access, version changes, and audit evidence.

Google Cloud **Secret Manager** stores sensitive values as named secrets with versions. IAM controls who can access the secret payload. Cloud Audit Logs record access and management activity. Rotation workflows can add new versions and move applications to the new value without pasting the value into tickets or logs.

Keep these questions in view as you work through the lesson:

1. **What Is the Runtime Secret Problem?**
2. **What Does a Secret Version Identify?**
3. **Who May Retrieve the Secret Payload?**
4. **How Do You Rotate a Secret Without Breaking Consumers?**
5. **When Should a Workload Use a Version Number or an Alias?**
6. **How Does Delayed Destruction Create a Recovery Window?**
7. **How Do These Ideas Map to AWS Secrets Manager?**
8. **How Do You Prove Secret Use Without Printing the Payload?**

## What Is the Runtime Secret Problem?
<!-- section-summary: Runtime secrets are sensitive values an app needs while running, so they need a managed home outside code, images, and logs. -->

The running example is a Cloud Run service named `payment-webhook` that validates incoming payment events. It needs a webhook signing key at runtime. The key should be available to that service, hidden from normal log readers, rotated as the provider requires a new key, and recoverable if a rollout points to the wrong value.

A secret is information whose confidentiality is part of an authorization mechanism. Whoever possesses the database password, signing key, or API token may be able to act as the application. Encryption at rest protects the stored copy, but the application eventually needs usable plaintext. The real problem is delivering that authority to exactly the workload that needs it, when it needs it, without spreading permanent copies through source repositories, laptops, CI logs, images, backups, and deployment manifests.

Two trust relationships meet at runtime. The Cloud Run service first proves its workload identity to Google Cloud. IAM decides whether that identity may access a particular secret version. After retrieval, the application can use the secret itself to prove something to the external provider. Workload identity is therefore the bootstrap credential; the external secret is not the application's Google Cloud identity.

Runtime delivery can take several forms. The application can call the Secret Manager API and own fetching, caching, refresh, and failure handling. The platform can inject a value into an environment variable before an instance starts. A mounted secret volume can expose the value as a file and support runtime reads. Every method eventually places plaintext somewhere the process can use it, so the goal is to reduce the number, lifetime, and blast radius of copies rather than pretend plaintext never exists.

### The Secret Is the Stable Home
<!-- section-summary: A secret is the named resource that holds metadata, IAM policy, versions, aliases, and rotation settings. -->

A **secret** is the stable Google Cloud resource that represents one sensitive value. The easiest way to picture it is a locked mailbox with a permanent label. The mailbox label stays the same, while the letter inside can change over time through versions.

The secret has a name, labels, replication settings, IAM policy, rotation metadata, optional version aliases, and one or more versions. In the example, the secret name is `payment-webhook-signing-key`.

The secret name should describe the job, not the current value. The payment team may rotate the signing key many times, yet the Cloud Run service can keep asking for the same secret. The changing part lives in versions.

That stable-name design keeps application configuration calm during rotation. The app does not need a new environment variable every time the payment provider issues a new key. The team adds a new version under the same secret, then moves the runtime to the version or alias chosen by the release plan.

Create the secret resource before adding the payload:

```bash
gcloud secrets create payment-webhook-signing-key \
  --project=payments-prod \
  --replication-policy=automatic \
  --labels=service=payment-webhook,env=prod
```

- `payment-webhook-signing-key` is the stable secret name the team will review.
- `--replication-policy=automatic` lets Secret Manager manage replication locations.
- `--labels` helps inventory, ownership, and review workflows find the secret later.

Expected output should confirm that the secret resource exists:

```yaml
Created secret [payment-webhook-signing-key].
```

- The output does not contain a secret value because no payload has been added yet.
- The secret now has a policy boundary where IAM can grant access.
- Labels are metadata, so do not place private values in labels.

## What Does a Secret Version Identify?
<!-- section-summary: A secret version is an immutable payload snapshot stored under the secret. -->

A **secret version** is the exact stored payload at one point in time. Version `1` may contain the current webhook signing key. Version `2` may contain the next key created during rotation. Secret versions are immutable, so changing the sensitive value means adding another version.

The version is the part that turns "we rotated the key" into something reviewable. A ticket can say Cloud Run revision `payment-webhook-00018` used `payment-webhook-signing-key` version `2`. That sentence proves which payload snapshot the runtime used without printing the payload itself.

That versioned design is useful because runtime rollout and provider rotation rarely happen in one perfect step. You can add a new version, test it with controlled traffic, move the app to the new value, and keep the old version available during the rollback window.

Add the first payload from a controlled file:

```bash
gcloud secrets versions add payment-webhook-signing-key \
  --project=payments-prod \
  --data-file=/secure-input/payment-webhook-signing-key-v1.txt
```

- `versions add` creates a new immutable version under the existing secret.
- `--data-file` keeps the value out of shell history and command output.
- The file should be produced and stored by a controlled rotation or secret intake process.

Expected output should name the created version:

```yaml
Created version [1] of the secret [payment-webhook-signing-key].
```

- Version `1` is the exact payload snapshot.
- Later versions do not edit version `1`; they add new payload snapshots.
- Version numbers are useful in release records because they identify the exact value without exposing it.

The stable secret and immutable version solve different lifecycle jobs. `payment-webhook-signing-key` can remain the policy and configuration home for years. Version `1`, `2`, or `43` identifies exact bytes from one point in that history. If version 39 is bad and version 38 is known good, rollback can name the earlier payload without trying to reconstruct what the string used to contain.

## Who May Retrieve the Secret Payload?
<!-- section-summary: The accessor is the runtime principal allowed to retrieve a secret version payload. -->

An **accessor** is the principal that can retrieve a secret payload. In IAM terms, the common runtime role is `roles/secretmanager.secretAccessor`, which includes the permission needed to access secret version data. Metadata viewing and payload access are different jobs, so do not grant payload access to every person who can list secrets.

For `payment-webhook`, the accessor should be the Cloud Run runtime service account:

`serviceAccount:payment-webhook@payments-prod.iam.gserviceaccount.com`

Grant payload access on the single secret:

```bash
gcloud secrets add-iam-policy-binding payment-webhook-signing-key \
  --project=payments-prod \
  --member="serviceAccount:payment-webhook@payments-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

- The secret is the resource receiving the binding.
- The member is the workload identity that reads the key at runtime.
- The role grants payload access, so keep the scope as narrow as the service allows.

Expected output should show the service account under Secret Accessor:

```yaml
bindings:
- members:
  - serviceAccount:payment-webhook@payments-prod.iam.gserviceaccount.com
  role: roles/secretmanager.secretAccessor
etag: BwYh6x9kYpQ=
version: 1
```

- The runtime service account appears as the accessor.
- The binding belongs on the secret, not broadly on every secret in the project.
- The `etag` shows that the policy update returned a versioned policy document.

Cloud Run can consume a Secret Manager value through an environment variable or a mounted file. The environment variable approach is simple for many apps, while mounted files fit apps that already read config from the filesystem. In both cases, the runtime service account still needs Secret Accessor on the secret.

This answers the bootstrap question: the workload does not store a second permanent password merely to retrieve its first password. Cloud Run supplies short-lived platform credentials for the attached service account. Google client libraries use that identity to call Secret Manager, and Secret Manager IAM evaluates the request. Storing a long-lived Secret Manager credential next to the application would simply recreate the original problem.

```bash
gcloud run services update payment-webhook \
  --project=payments-prod \
  --region=us-central1 \
  --service-account=payment-webhook@payments-prod.iam.gserviceaccount.com \
  --update-secrets=WEBHOOK_SIGNING_KEY=payment-webhook-signing-key:1
```

- `--service-account` confirms the runtime identity that will request the secret.
- `--update-secrets` maps an environment variable to a specific secret version.
- Pinning version `1` gives a clear first rollout record before aliases enter the workflow.

## How Do You Rotate a Secret Without Breaking Consumers?
<!-- section-summary: Rotation adds a new version and moves runtime traffic after the new value has been prepared and verified. -->

**Rotation** is the process of replacing a sensitive value with a new one. A good rotation plan handles both sides of the secret. The external system, such as the payment provider, needs to accept the new signing key. The app needs to receive the matching value from Secret Manager. The team needs a rollback path if validation fails.

For the webhook key, a safe rotation might use an overlap window. The payment provider can send events signed with the new key while the app is being updated, or the app can temporarily accept both old and new keys if the provider supports a staged change. The exact method depends on the external system, so the release record should spell out how validation works.

Add the new version after the provider-side key exists:

```bash
gcloud secrets versions add payment-webhook-signing-key \
  --project=payments-prod \
  --data-file=/secure-input/payment-webhook-signing-key-v2.txt
```

- The command creates version `2` under the same secret.
- The payload remains outside logs and command history.
- The version number should go into the rotation record and deployment ticket.

Expected output should name the next version:

```yaml
Created version [2] of the secret [payment-webhook-signing-key].
```

- Version `1` can stay enabled during the rollout window.
- Version `2` can be tested with a controlled deployment or traffic shift.
- The app should never print either payload while proving the rotation worked.

Adding version `2` does not change the provider's real signing key by itself. Rotation must coordinate the credential authority, the Secret Manager version, and every consumer. A safe overlap lets old and new credentials work long enough to test the new path, move workloads, confirm success, revoke the old credential, and only later destroy obsolete material. Without overlap, rotation becomes an all-at-once distributed transaction across every live instance.

A Secret Manager rotation schedule can trigger automation, but the surrounding workflow still has to create or change the credential in the external system and add the matching version. A schedule is therefore an orchestration signal rather than proof that the provider and stored payload now agree.

## When Should a Workload Use a Version Number or an Alias?
<!-- section-summary: A version alias is a readable pointer to a secret version that can move during a release. -->

A **version alias** is a readable name that points to a version. After the secret has versions, an alias such as `current` can point to version `1` and later move to version `2`. The app can request `payment-webhook-signing-key:current` instead of hardcoding the number in runtime configuration.

Aliases are useful because they turn the secret value change into a release action. The release record can say that `current` moved from version `1` to version `2`, Cloud Run rolled a new revision, and validation passed. That gives reviewers a named pointer without exposing the key.

Move the alias after version `2` is ready:

```bash
gcloud secrets update payment-webhook-signing-key \
  --project=payments-prod \
  --update-version-aliases=current=2
```

- The command updates secret metadata, not the payload.
- `current=2` points the alias at the new version.
- The caller needs permission to update the secret's metadata or aliases.

Expected output should show the alias map:

```yaml
name: projects/123456789/secrets/payment-webhook-signing-key
versionAliases:
  current: '2'
```

- The alias now points to version `2`.
- Cloud Run environment variables resolve secret values as instances start, so deploy or restart behavior should be part of the rollout.
- A rollback can move `current` back to version `1` if the external provider still accepts the old key.

Update Cloud Run to use the alias after the team is ready for alias-based releases:

```bash
gcloud run services update payment-webhook \
  --project=payments-prod \
  --region=us-central1 \
  --update-secrets=WEBHOOK_SIGNING_KEY=payment-webhook-signing-key:current
```

- The runtime configuration now follows the alias.
- The update creates a new Cloud Run revision for environment-variable based secrets.
- The release record should include the old alias target, new alias target, revision, and verification result.

A numbered selector gives determinism: version `2` always means the same immutable payload. An alias gives operational flexibility because `current` can move without changing the application reference. `latest` adds even more automatic movement and can expose every consumer to a newly added bad value. Version-number access is also the strongest consistency reference; aliases and `latest` introduce an indirection whose propagation and rollout behavior must be considered. An alias is a deployment-control mechanism, not merely a friendlier spelling.

## How Does Delayed Destruction Create a Recovery Window?
<!-- section-summary: Delayed destruction keeps a scheduled-for-destruction version recoverable during a configured window. -->

**Delayed destruction** gives a secret version a recovery window before permanent destruction. After a version is scheduled for destruction, Secret Manager disables it and keeps it recoverable until the delay period ends. After permanent destruction, the payload is gone.

This matters after rotation. The payment team may want to remove old key material, while operations may still need a short rollback path. A common pattern is to disable the old version after the new version has soaked, wait long enough to prove no caller still uses it, then schedule destruction with delayed destruction configured.

The recovery window is configured on the secret, not on each version. For a seven-day window on `payment-webhook-signing-key`, the admin updates the secret metadata:

```bash
gcloud secrets update payment-webhook-signing-key \
  --project=payments-prod \
  --version-destroy-ttl=7d
```

- `--version-destroy-ttl=7d` means a version destroy request schedules destruction seven days later.
- Google Cloud accepts duration formats such as days, hours, or seconds. Choose a window that matches the team's rollback policy and compliance rules.
- This setting protects secret versions; deleting the whole secret or letting an expiring secret expire can still remove the secret material immediately.

Check the configured window before touching the old payload:

```bash
gcloud secrets describe payment-webhook-signing-key \
  --project=payments-prod \
  --format='yaml(name,versionDestroyTtl)'
```

```yaml
name: projects/payments-prod/secrets/payment-webhook-signing-key
versionDestroyTtl: 604800s
```

- `604800s` is seven days.
- If `versionDestroyTtl` is missing, a destroy request can remove the payload immediately and permanently.
- The rotation ticket should record this value before cleanup begins.

Disable the old version first:

```bash
gcloud secrets versions disable 1 \
  --project=payments-prod \
  --secret=payment-webhook-signing-key
```

- Disabling makes version `1` unavailable for normal access.
- The payload still exists, so the team can re-enable it if the rollout record supports rollback.
- The command should run only after evidence shows version `2` works.

Expected output should show the disabled state:

```console
Disabled version [1] of the secret [payment-webhook-signing-key].
```

- Disabled is a reversible state.
- A reviewer can check audit logs for the caller and timestamp.
- The release record should mention why the old version is safe to disable.

Schedule destruction only after the new version has passed production checks:

```bash
gcloud secrets versions destroy 1 \
  --project=payments-prod \
  --secret=payment-webhook-signing-key
```

With delayed destruction configured, the output should show a disabled version plus a scheduled destruction timestamp:

```yaml
name: projects/payments-prod/secrets/payment-webhook-signing-key/versions/1
state: DISABLED
scheduledDestroyTime: '2026-07-11T09:30:00Z'
```

- `state: DISABLED` means normal secret access cannot retrieve the payload.
- `scheduledDestroyTime` is the last point before permanent destruction.
- The app, provider webhook validation, and monitoring should all point at version `2` before the scheduled time arrives.

If the rollout fails during the window, restore version `1` by enabling it again:

```bash
gcloud secrets versions enable 1 \
  --project=payments-prod \
  --secret=payment-webhook-signing-key
```

```yaml
name: projects/payments-prod/secrets/payment-webhook-signing-key/versions/1
state: ENABLED
```

- Restoring does not move the `current` alias by itself. If rollback needs the old payload, move the alias or runtime configuration deliberately.
- The rollback note should name the failed version, the restored version, the alias change, and the app revision that consumed it.
- After the issue is fixed, repeat the disable and destroy-schedule flow so cleanup still happens.

After `scheduledDestroyTime`, the recovery window is over. A version check should show permanent loss:

```bash
gcloud secrets versions describe 1 \
  --project=payments-prod \
  --secret=payment-webhook-signing-key \
  --format='yaml(name,state,destroyTime)'
```

```yaml
name: projects/payments-prod/secrets/payment-webhook-signing-key/versions/1
state: DESTROYED
destroyTime: '2026-07-11T09:30:01Z'
```

- `state: DESTROYED` means Secret Manager cannot return the old payload.
- Recovery now depends on an external backup or provider-side key rotation process, which may be unavailable or unsafe.
- A good cleanup review keeps the scheduled timestamp, final destroyed state, audit log entry, and current working version together.

## How Do These Ideas Map to AWS Secrets Manager?
<!-- section-summary: Secret Manager overlaps with AWS Secrets Manager and parts of SSM Parameter Store, with Google Cloud IAM and KMS details around it. -->

AWS readers can think of Google Cloud Secret Manager as closest to AWS Secrets Manager for versioned sensitive values and rotation workflows. Some teams also compare it with SSM Parameter Store for configuration-like values, yet Secret Manager is the Google Cloud service designed for secret payload access, versions, IAM checks, audit logs, rotation metadata, and lifecycle controls.

Encryption is managed by Google Cloud by default. If your compliance model requires customer-managed keys, Secret Manager can use Cloud KMS for customer-managed encryption keys. Keep that separate from the application-level secret value. KMS protects how Secret Manager stores the value; Secret Manager IAM controls who can retrieve the payload through the service.

The operational habit is similar across both clouds. Give the runtime identity access to only the secret it needs, rotate by adding a new version, keep old versions long enough for rollback, and collect audit evidence without printing the secret value.

The concepts do not map perfectly. GCP version aliases resemble AWS staging labels such as `AWSCURRENT`, `AWSPENDING`, and `AWSPREVIOUS`. GCP delayed destruction applies to a secret version, while AWS handles individual-version cleanup and whole-secret recovery windows differently. Map stable home, exact payload, workload identity, accessor permission, movable pointer, rotation, and audit evidence first; then learn the provider-specific lifecycle operation.

## How Do You Prove Secret Use Without Printing the Payload?
<!-- section-summary: Secret reviews should prove access, version, and rollout state without exposing the secret value. -->

A good secret review never needs the secret value in the review ticket. The team can prove the important facts with metadata, IAM policy, runtime revision settings, audit logs, and application health checks.

This matters because secret reviews can accidentally create a second leak. Copying a database password, API token, or webhook secret into a ticket, chat, or screenshot spreads the secret outside its controlled store. The safer review proves that the secret exists, which version the service uses, which identity can read it, and whether the application started successfully after rotation.

For example, a payment provider token review should show the Secret Manager secret name, active version number, runtime service account, Cloud Run revision configuration, and one sanitized application log line. It should never show the token characters. The goal is confidence in the path, not exposure of the payload.

For `payment-webhook`, the evidence package should answer these questions:

| Evidence question | Useful proof |
|---|---|
| Which secret stores the key? | Secret name, project, labels, and owner. |
| Which version is active? | Alias map or runtime configuration showing version `2` or `current=2`. |
| Which workload can read it? | Secret IAM policy showing the runtime service account as accessor. |
| Which revision consumed it? | Cloud Run revision configuration and deployment record. |
| Did anyone access or change it? | Cloud Audit Logs for access, version creation, alias update, disable, restore, or destroy events. |

During debugging, keep secret values out of logs. Log the secret name, version selector, revision, and sanitized error code. If the app needs to prove a key works, use an external health check or provider verification result rather than printing the key or its hash into normal logs.

Cloud Audit Logs can show an `AccessSecretVersion` data-access event with caller identity, resource, version, time, and outcome when the relevant logging is enabled. The application can separately record that credentials from version `2` loaded and downstream authentication succeeded. Together those facts prove the path without logging the secret or even a hash that could help test guesses for a low-entropy value.

The deeper model is lifecycle control over authority. Identity decides who may obtain the authority. Versions make each change exact. Rotation shortens its useful lifetime. Aliases control rollout. Delayed destruction makes a dangerous cleanup action recoverable before final erasure. Runtime delivery keeps the value out of long-lived software artifacts.

## Check Your Answers

:::expand[What Is the Runtime Secret Problem?]{kind="recap"}
The workload needs usable plaintext, but the value should reach only the authorized runtime without permanent copies in code, images, repositories, or deployment files.
:::

:::expand[What Does a Secret Version Identify?]{kind="recap"}
The secret is the stable policy and metadata home; a numbered version is one exact immutable payload in its history.
:::

:::expand[Who May Retrieve the Secret Payload?]{kind="recap"}
The workload authenticates with its service account, and IAM grants `secretAccessor` as narrowly as possible on the required secret.
:::

:::expand[How Do You Rotate a Secret Without Breaking Consumers?]{kind="recap"}
Create the real new credential, store a matching version, overlap and test consumers, move them, revoke the old credential, observe, and destroy it only after the recovery window.
:::

:::expand[When Should a Workload Use a Version Number or an Alias?]{kind="recap"}
A number gives deterministic payload selection. An alias gives a movable release pointer, while `latest` trades still more control for convenience.
:::

:::expand[How Does Delayed Destruction Create a Recovery Window?]{kind="recap"}
The destroy request disables the version and schedules final erasure, allowing restoration during the configured delay before the payload becomes irrecoverable.
:::

:::expand[How Do These Ideas Map to AWS Secrets Manager?]{kind="recap"}
Map secret, version, accessor permission, workload identity, movable pointer, rotation, and audit evidence conceptually; aliases, staging labels, and destruction semantics differ.
:::

:::expand[How Do You Prove Secret Use Without Printing the Payload?]{kind="recap"}
Record caller identity, access event, secret and version, runtime revision, sanitized outcome, and downstream authentication result—never the secret or a fingerprint.
:::

## References

- [Secret Manager overview](https://docs.cloud.google.com/secret-manager/docs/overview) - Explains secrets, versions, labels, aliases, and lifecycle features.
- [Access control with IAM](https://docs.cloud.google.com/secret-manager/docs/access-control) - Documents Secret Manager IAM roles and access patterns.
- [Access a secret version](https://docs.cloud.google.com/secret-manager/docs/access-secret-version) - Explains version IDs, aliases, and accessing payload data.
- [Assign an alias to a secret version](https://docs.cloud.google.com/secret-manager/docs/assign-alias-to-secret-version) - Documents version aliases and how they are assigned.
- [About rotation schedules](https://docs.cloud.google.com/secret-manager/docs/rotation-recommendations) - Explains rotation scheduling and cautions around the `latest` selector.
- [Delay destruction of secret versions](https://docs.cloud.google.com/secret-manager/docs/delay-destruction-of-secret-versions) - Documents delayed destruction and restore behavior.
- [Secret Manager best practices](https://docs.cloud.google.com/secret-manager/docs/best-practices) - Covers practical guidance for secret lifecycle, access, and cleanup.
