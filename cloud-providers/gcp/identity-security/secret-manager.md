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

1. [The Runtime Secret Problem](#the-runtime-secret-problem)
2. [Secret: The Stable Home for a Sensitive Value](#secret-the-stable-home-for-a-sensitive-value)
3. [Version: The Exact Stored Payload](#version-the-exact-stored-payload)
4. [Accessor: Who May Retrieve the Payload](#accessor-who-may-retrieve-the-payload)
5. [Rotation: Changing the Value Safely](#rotation-changing-the-value-safely)
6. [Alias: A Named Pointer to a Version](#alias-a-named-pointer-to-a-version)
7. [Delayed Destruction: A Recovery Window](#delayed-destruction-a-recovery-window)
8. [How AWS Readers Can Map the Ideas](#how-aws-readers-can-map-the-ideas)
9. [Runtime Evidence Without Printing Payloads](#runtime-evidence-without-printing-payloads)
10. [References](#references)

## The Runtime Secret Problem
<!-- section-summary: Runtime secrets are sensitive values an app needs while running, so they need a managed home outside code, images, and logs. -->

An app often needs one private value after it starts. A payment service needs a provider API key. A webhook receiver needs a signing key. A backend needs a database password. Those values are small strings, yet they carry real access to money movement, customer data, or internal systems.

Putting those values in source code, Docker images, Terraform outputs, Slack messages, or plain environment files creates a recovery problem. Anyone who can see the file may see the value, and rotation requires hunting down every copy. A managed secret store gives you one place to control access, version changes, and audit evidence.

Google Cloud **Secret Manager** stores sensitive values as named secrets with versions. IAM controls who can access the secret payload. Cloud Audit Logs record access and management activity. Rotation workflows can add new versions and move applications to the new value without pasting the value into tickets or logs.

The running example is a Cloud Run service named `payment-webhook` that validates incoming payment events. It needs a webhook signing key at runtime. The key should be available to that service, hidden from normal log readers, rotated as the provider requires a new key, and recoverable if a rollout points to the wrong value.

## Secret: The Stable Home for a Sensitive Value
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

## Version: The Exact Stored Payload
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

![Secret version rollout](/content-assets/articles/article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics/secret-version-rollout.png)
*A secret gives the stable name, and versions give the exact payload snapshots used during rollout and rollback.*

## Accessor: Who May Retrieve the Payload
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

![Runtime secret access](/content-assets/articles/article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics/runtime-secret-access.png)
*Runtime access should flow through the workload identity, Secret Manager IAM, and a controlled version selector.*

## Rotation: Changing the Value Safely
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

## Alias: A Named Pointer to a Version
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

## Delayed Destruction: A Recovery Window
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

![Secret rotation evidence](/content-assets/articles/article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics/secret-rotation-evidence.png)
*A useful rotation record shows version creation, alias movement, runtime rollout, validation, old-version disablement, and cleanup evidence.*

## How AWS Readers Can Map the Ideas
<!-- section-summary: Secret Manager overlaps with AWS Secrets Manager and parts of SSM Parameter Store, with Google Cloud IAM and KMS details around it. -->

AWS readers can think of Google Cloud Secret Manager as closest to AWS Secrets Manager for versioned sensitive values and rotation workflows. Some teams also compare it with SSM Parameter Store for configuration-like values, yet Secret Manager is the Google Cloud service designed for secret payload access, versions, IAM checks, audit logs, rotation metadata, and lifecycle controls.

Encryption is managed by Google Cloud by default. If your compliance model requires customer-managed keys, Secret Manager can use Cloud KMS for customer-managed encryption keys. Keep that separate from the application-level secret value. KMS protects how Secret Manager stores the value; Secret Manager IAM controls who can retrieve the payload through the service.

The operational habit is similar across both clouds. Give the runtime identity access to only the secret it needs, rotate by adding a new version, keep old versions long enough for rollback, and collect audit evidence without printing the secret value.

## Runtime Evidence Without Printing Payloads
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

## References

- [Secret Manager overview](https://docs.cloud.google.com/secret-manager/docs/overview) - Explains secrets, versions, labels, aliases, and lifecycle features.
- [Access control with IAM](https://docs.cloud.google.com/secret-manager/docs/access-control) - Documents Secret Manager IAM roles and access patterns.
- [Access a secret version](https://docs.cloud.google.com/secret-manager/docs/access-secret-version) - Explains version IDs, aliases, and accessing payload data.
- [Assign an alias to a secret version](https://docs.cloud.google.com/secret-manager/docs/assign-alias-to-secret-version) - Documents version aliases and how they are assigned.
- [About rotation schedules](https://docs.cloud.google.com/secret-manager/docs/rotation-recommendations) - Explains rotation scheduling and cautions around the `latest` selector.
- [Delay destruction of secret versions](https://docs.cloud.google.com/secret-manager/docs/delay-destruction-of-secret-versions) - Documents delayed destruction and restore behavior.
- [Secret Manager best practices](https://docs.cloud.google.com/secret-manager/docs/best-practices) - Covers practical guidance for secret lifecycle, access, and cleanup.
