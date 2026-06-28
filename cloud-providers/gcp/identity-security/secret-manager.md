---
title: "Secret Manager and Runtime Secrets"
description: "Store runtime secrets in Google Cloud Secret Manager, grant narrow access, rotate versions safely, and prove access without exposing payloads."
overview: "Runtime secrets are the values an application needs after it starts, such as database passwords, API tokens, and private keys. This article follows the orders-db-password secret for the Cloud Run service devpolaris-orders-api through versions, IAM, runtime access, aliases, rotation, destruction safety, CMEK, VPC Service Controls, and runtime evidence."
tags: ["gcp", "secret-manager", "runtime-secrets", "rotation"]
order: 3
id: article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics
aliases:
  - secret-manager-and-encryption-basics
  - cloud-providers/gcp/identity-security/secret-manager-and-encryption-basics.md
---

## Table of Contents

1. [Runtime Secrets](#runtime-secrets)
2. [Secrets and Secret Versions](#secrets-and-secret-versions)
3. [Runtime Access From Cloud Run, GKE, and Compute Engine](#runtime-access-from-cloud-run-gke-and-compute-engine)
4. [IAM for Secret Access](#iam-for-secret-access)
5. [Version Aliases and Safe Rollouts](#version-aliases-and-safe-rollouts)
6. [Rotation Schedules and Pub/Sub Notifications](#rotation-schedules-and-pubsub-notifications)
7. [Delayed Destruction and Restore](#delayed-destruction-and-restore)
8. [CMEK and Cloud KMS](#cmek-and-cloud-kms)
9. [VPC Service Controls](#vpc-service-controls)
10. [Runtime Evidence Without Printing Payloads](#runtime-evidence-without-printing-payloads)
11. [Putting It All Together](#putting-it-all-together)

## Runtime Secrets
<!-- section-summary: Runtime secrets are sensitive values used by running workloads, so they need a managed home away from code, images, and logs. -->

A **runtime secret** is a sensitive value that an application needs while it is running. The common examples are database passwords, API tokens, webhook signing keys, OAuth client secrets, TLS private keys, and service credentials for systems outside Google Cloud.

For this article, we will follow one real production story. The Cloud Run service `devpolaris-orders-api` connects to the orders database, and the database password lives in Secret Manager as a secret named `orders-db-password`. The service needs the password at runtime, the platform team needs to rotate it, and the security team needs evidence that the service used the right secret without copying the password into a ticket.

Secret Manager gives that password a managed home. It stores the secret value as versioned data, applies IAM to the secret resource, encrypts data by default, writes audit logs, sends rotation notifications through Pub/Sub, supports optional customer-managed encryption keys, and can sit inside a VPC Service Controls perimeter for higher-risk environments.

The flow in this article stays close to how a team would run this in production. First we separate the stable secret from the actual payload versions, then we connect Cloud Run, GKE, and Compute Engine workloads, then we narrow IAM, move an alias from version `7` to version `8`, rotate through Pub/Sub, protect old versions from accidental destruction, and collect evidence without printing the secret value.

## Secrets and Secret Versions
<!-- section-summary: The secret is the stable container and policy boundary, while each secret version is an immutable stored payload. -->

A **secret** is the named resource that holds metadata, IAM policy, labels, replication settings, rotation settings, optional aliases, and one or more versions. In our example, `orders-db-password` is the secret, and application code can refer to that stable name for months or years.

A **secret version** is the actual stored payload at one point in time. Version `7` might contain the current database password used by `devpolaris-orders-api`, and version `8` might contain the new password created during the next rotation. Secret versions are immutable, so changing a password means adding a new version rather than editing the old one.

That split matters during a database password rotation. The release manager can create version `8`, test it, point the `current` alias to it, and keep version `7` available during the rollout window. The service name and secret name stay stable while the payload moves forward through a controlled release.

The small vocabulary below keeps the rest of the article clear. We will use these exact words in the rollout story so version changes, aliases, and rollback choices stay easy to follow.

| Term | Example | What the team uses it for |
|---|---|---|
| **Secret** | `orders-db-password` | Stable resource name, IAM policy boundary, rotation schedule, alias map, and audit target. |
| **Version** | `7`, `8` | Immutable payload snapshots. Version `7` can remain enabled while version `8` is tested. |
| **Alias** | `current` | Human-friendly pointer to a version. Moving `current` from `7` to `8` is a release action. |
| **Special latest version** | `latest` | Secret Manager's newest version selector. It is convenient, but production rollouts usually need a more explicit release record. |

For a beginner, the useful way to think about this is simple. The secret name is the stable place your workload asks for, and the version is the exact value it receives. The release process decides which version the workload should use.

![Secret version rollout](/content-assets/articles/article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics/secret-version-rollout.png)
*Secret rotation is easier to review when the stable secret, immutable versions, alias move, runtime rollout, and rollback path are shown as one release flow.*

## Runtime Access From Cloud Run, GKE, and Compute Engine
<!-- section-summary: Google Cloud workloads use their runtime identity to retrieve secrets through Secret Manager integrations or the Secret Manager API. -->

Now that the password has a home, the next question is how a running service gets it. In Google Cloud, the clean answer is usually **service identity plus Secret Manager access**, which means the workload runs as a service account and Secret Manager checks whether that service account can access the requested secret version.

For **Cloud Run**, the service identity for `devpolaris-orders-api` should have access to `orders-db-password`. Cloud Run can expose a secret as an environment variable or mount it as a file. Environment variables are read when the instance starts, while mounted secret files fit workloads that read from the filesystem and need a rotation-friendly path.

```bash
gcloud secrets add-iam-policy-binding orders-db-password \
  --member="serviceAccount:devpolaris-orders-runtime@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud run services update devpolaris-orders-api \
  --region=europe-west2 \
  --service-account=devpolaris-orders-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --update-secrets=ORDERS_DB_PASSWORD=orders-db-password:current
```

Run the first command when the runtime service account needs payload access to this one secret. The `--member` flag names the Cloud Run identity, and `--role` grants the permission bundle that includes `secretmanager.versions.access`. Run the second command when the Cloud Run service should consume the secret through an environment variable. The `--service-account` flag confirms the runtime identity, and `--update-secrets` maps `ORDERS_DB_PASSWORD` to the `current` alias.

Healthy output from the binding should show the runtime account under Secret Accessor:

```yaml
bindings:
- members:
  - serviceAccount:devpolaris-orders-runtime@PROJECT_ID.iam.gserviceaccount.com
  role: roles/secretmanager.secretAccessor
etag: BwYF4oQnK2M=
version: 1
```

Healthy output from the service update should show a new revision:

```yaml
Deploying...
OK Deploying new revision... Done.
Traffic:
  100% LATEST (currently devpolaris-orders-api-00017-bxq)
```

That example uses the alias `current` as the version selector. Since Cloud Run environment variables are resolved when an instance starts, the rollout should create a new revision or restart instances after the alias moves. For services that mount secrets as files, the application should read the file at the point it opens a new database connection rather than caching the value forever.

![Runtime secret access](/content-assets/articles/article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics/runtime-secret-access.png)
*Cloud Run, GKE, and Compute Engine can all reach Secret Manager through their runtime identities, while the secret payload stays out of images, logs, Terraform outputs, and copied environment files.*

For **GKE**, there are two common patterns. A pod can call the Secret Manager API through a client library while authenticated with Workload Identity Federation for GKE, or it can use the Secret Manager add-on to mount secrets as volumes in pods. The important distinction for beginners is that a Secret Manager secret and a Kubernetes `Secret` object are separate things, even though the names sound similar.

For **Compute Engine**, the VM runs as a service account and application code can use a Secret Manager client library or call the API directly. Compute Engine and GKE workloads also need the `cloud-platform` OAuth scope on the underlying instance or node path, because the access token has to be allowed to call Google Cloud APIs. IAM grants the permission, and the OAuth scope has to leave enough room for the token to use that permission.

The runtime rule is the same across all three platforms. The workload should use its attached identity, Secret Manager should hold the sensitive value, and code should avoid storing the payload in container images, startup scripts, logs, Terraform state outputs, or copied environment files.

## IAM for Secret Access
<!-- section-summary: Secret IAM should be granted at the narrowest practical level, with separate roles for reading payloads and managing versions. -->

Once a workload can technically reach Secret Manager, IAM decides whether it can read the payload. The key role for runtime access is **Secret Manager Secret Accessor**, written as `roles/secretmanager.secretAccessor`. This role includes `secretmanager.versions.access`, which is the permission that returns the actual secret payload.

The role should be granted on the single secret whenever the workload needs only one secret. In our example, the `devpolaris-orders-runtime` service account should get accessor access on `orders-db-password` rather than broad project-level access. A project-level grant would let the orders API read unrelated secrets, such as payment provider tokens or internal admin credentials.

Different automation needs different roles. The Cloud Run service reads the payload, so it needs accessor. The rotation worker creates version `8`, so it may need **Secret Version Adder** or **Secret Version Manager** on `orders-db-password`. The release automation that moves the `current` alias needs permission to update the secret metadata, which teams often handle with a narrow custom role or a tightly scoped secret admin grant on this one secret.

The access split below keeps runtime access separate from rotation access. The service account serving traffic receives the ability to read the password, while the automation identities receive the smaller management powers needed for their jobs.

| Principal | Role scope | Why it has that access |
|---|---|---|
| `devpolaris-orders-runtime@PROJECT_ID.iam.gserviceaccount.com` | `roles/secretmanager.secretAccessor` on `orders-db-password` | The running API needs to retrieve the password. |
| `orders-secret-rotator@PROJECT_ID.iam.gserviceaccount.com` | `roles/secretmanager.secretVersionAdder` or a narrow custom role on `orders-db-password` | Rotation automation needs to add version `8`. |
| `orders-release-bot@PROJECT_ID.iam.gserviceaccount.com` | Permission to update aliases on `orders-db-password` | Release automation needs to move `current` after verification. |
| Security reviewers | Metadata viewer access, plus audit log access | Reviewers need evidence and policy visibility while the password payload stays hidden. |

This separation gives you a cleaner incident story. If the orders API service account is compromised, the attacker gets the one database password it already needed rather than every secret in the project. If the rotation worker fails, it can add or manage versions without becoming the same identity that serves customer traffic.

## Version Aliases and Safe Rollouts
<!-- section-summary: A version alias turns secret rotation into a release step that can be verified and rolled back. -->

A **secret version alias** is a readable name that points to a secret version. Secret Manager lets you access an assigned alias the same way you access a version number, so `orders-db-password` version `8` can be reached through the alias `current` after the release team moves the pointer.

Aliases help because database password rotation is a production change with storage, database, and rollout pieces. The team needs to answer basic release questions: which version was active before, which version is active now, what step moved the service, how did we verify it, and what can we do if the new value fails.

The release record below shows the shape of a safe rotation for `devpolaris-orders-api` from version `7` to version `8`. It gives the on-call engineer enough information to verify the change or roll it back without asking anyone to reveal the password.

| Release field | Value |
|---|---|
| Secret | `orders-db-password` |
| Runtime service | `devpolaris-orders-api` on Cloud Run |
| Old version | Version `7`, enabled, alias `current` before the change |
| New version | Version `8`, enabled, alias `current` after verification |
| Rollout step | Add version `8`, make the database accept the new credential, move `current=8`, deploy a new Cloud Run revision, shift traffic gradually |
| Verification query | `select usename, application_name, state, count(*) from pg_stat_activity where application_name = 'devpolaris-orders-api' group by 1, 2, 3;` |
| Rollback option | Move `current` back to `7`, route traffic to the previous Cloud Run revision, and make the database accept the version `7` value again if the database password was replaced |

The database side deserves a careful word. The smoothest rotation pattern gives the application an overlap window where both old and new credentials can work, often by using two database users such as `orders_app_a` and `orders_app_b`, or by using database support for multiple valid passwords. If the database account supports only one password at a time, the rollback process must reset the database account to the version `7` value before sending traffic back.

The alias update itself is small, but the release record around it is what makes the change safe. The commands are short by design, and the surrounding checklist carries the operational safety.

```bash
gcloud secrets versions add orders-db-password \
  --data-file=/secure-input/orders-db-password-v8.txt

gcloud secrets update orders-db-password \
  --update-version-aliases=current=8

gcloud run services update devpolaris-orders-api \
  --region=europe-west2 \
  --update-secrets=ORDERS_DB_PASSWORD=orders-db-password:current
```

The version-add command runs inside the rotation workflow after the database has a new credential ready. `--data-file` reads the payload from a controlled file so the password does not appear in shell history. The alias update moves the release pointer to version `8`, and the Cloud Run update rolls a revision that resolves `current` at startup.

Expected output should show the new version and then the alias update:

```yaml
Created version [8] of the secret [orders-db-password].

Updated secret [orders-db-password].
versionAliases:
  current: '8'
```

The file path in that example is deliberately boring and local to the secure rotation worker. The password value should come from a controlled password generator or database rotation workflow, and the value should stay out of shell history, build logs, pull requests, Slack messages, and incident notes.

## Rotation Schedules and Pub/Sub Notifications
<!-- section-summary: Secret Manager can send rotation events, while your automation performs the real credential change and verification. -->

A **rotation schedule** tells Secret Manager when a secret is due for rotation. Secret Manager sends a `SECRET_ROTATE` message to configured Pub/Sub topics at the scheduled time, and a subscriber handles the actual work. The schedule provides the signal, and the rotation worker performs the database password change, validation, and version update.

For `orders-db-password`, the subscriber might be a small Cloud Run service named `orders-secret-rotator`. It receives the Pub/Sub event, checks that the event is for `orders-db-password`, creates a new database password, stores it as version `8`, validates a database connection, writes a release record, and waits for the rollout automation to move `current`.

```bash
gcloud pubsub topics create secret-rotation-events

gcloud secrets update orders-db-password \
  --topics=projects/PROJECT_ID/topics/secret-rotation-events \
  --next-rotation-time="2026-07-01T09:00:00Z" \
  --rotation-period="2592000s"
```

Create the topic once so Secret Manager has a place to publish rotation and lifecycle events. The secret update then links the topic, sets the next due time, and sets the rotation period in seconds. `2592000s` is 30 days, and the timestamp should match the team's planned rotation window.

Healthy output should show the topic and the secret rotation fields:

```yaml
Created topic [projects/PROJECT_ID/topics/secret-rotation-events].

name: projects/PROJECT_ID/secrets/orders-db-password
rotation:
  nextRotationTime: '2026-07-01T09:00:00Z'
  rotationPeriod: 2592000s
topics:
- name: projects/PROJECT_ID/topics/secret-rotation-events
```

Pub/Sub also helps with normal lifecycle evidence. Secret Manager can publish events when versions are added, enabled, disabled, destroyed, or scheduled for destruction, and rotation events arrive as `SECRET_ROTATE`. A security team can use those events to start verification jobs, alert on unexpected version changes, or create change tickets automatically.

Rotation automation should be **idempotent** and **reentrant**. Idempotent means the same event can run twice without creating a confusing second outcome, and reentrant means the worker can resume after a crash. A common pattern is to store rotation state as labels or in a small state table, such as "created version 8", "database accepted version 8", "alias moved", and "old version disabled after soak".

## Delayed Destruction and Restore
<!-- section-summary: Delayed destruction gives teams a recovery window before old secret material is permanently destroyed. -->

Secret versions have a lifecycle. A version can be enabled, disabled, or destroyed, and destruction is the point where the payload is permanently removed. That makes old-version cleanup important, because deleting the only working rollback value during a rollout can turn a normal incident into a long outage.

**Delayed destruction** adds a safety window before permanent destruction. When delayed destruction is configured on a secret and someone destroys a version, Secret Manager disables that version, schedules permanent destruction for the end of the delay period, and keeps the version recoverable during that window. Google Cloud supports a configurable duration in days, with a documented range from 1 day to 1000 days.

For the orders password, version `7` should stay enabled during rollout, then move to disabled after the service has proven stable on version `8`. After a longer soak period, the team can schedule version `7` for destruction with delayed destruction enabled. That gives security the cleanup they want and gives operations a recovery path during the final cleanup period.

```bash
gcloud secrets versions disable 7 \
  --secret=orders-db-password

gcloud secrets versions destroy 7 \
  --secret=orders-db-password
```

Disable the old version after the new version has soaked and the team no longer wants normal runtime traffic to use version `7`. Destroy it only after the recovery window and release record support that cleanup. The `--secret` flag keeps the version number tied to the right secret.

Expected output should make the state change visible:

```yaml
Disabled version [7] of the secret [orders-db-password].

Destroyed version [7] of the secret [orders-db-password].
```

The restore path is simple while destruction is still scheduled. Enabling or disabling a scheduled version cancels the scheduled destruction and restores the version to that chosen state. In a real incident, the important part is the release record: the team should know that version `7` is the rollback value and that it remains inside the recovery window.

## CMEK and Cloud KMS
<!-- section-summary: Secret Manager encrypts secrets by default, and CMEK lets organizations control the key used for that encryption. -->

Secret Manager encrypts secret data by default at rest and uses secure transport for API access. For many teams, that default encryption is enough, and the most important controls are IAM, version lifecycle, audit logging, and clean rollout practice.

**CMEK** means customer-managed encryption key. With CMEK, Secret Manager uses a Cloud KMS key that your organization manages, which gives you control over the key location, rotation schedule, protection level, usage permissions, audit logs, and lifecycle. This matters for teams with compliance requirements around key ownership or separation of duties.

Cloud KMS and Secret Manager solve different problems. Secret Manager stores runtime values such as `orders-db-password`, and Cloud KMS manages cryptographic keys used to encrypt data. In production, the database password belongs in Secret Manager, and Cloud KMS can provide the optional encryption-key control behind Secret Manager when policy requires that extra control.

There are two operational details to remember. First, the KMS key has to align with the secret replica location it protects, and automatically replicated secrets use the documented `global` Cloud KMS multi-region for CMEK. Second, disabling or destroying the KMS key can make encrypted secret data inaccessible, so KMS key lifecycle changes need the same release discipline as secret rotation.

For `orders-db-password`, a regulated production setup might use a Cloud KMS key named `secret-manager-prod-runtime` and grant the Secret Manager service agent the Cloud KMS Encrypter/Decrypter role on that key. The runtime service account still needs Secret Manager accessor on the secret, because the KMS key grant lets Secret Manager use the key on behalf of the service rather than making the application decrypt secrets directly.

## VPC Service Controls
<!-- section-summary: VPC Service Controls adds a perimeter check around supported Google-managed services, including high-value Secret Manager access paths. -->

IAM answers who can access the secret. **VPC Service Controls** adds a perimeter around supported Google-managed services so access can be limited to trusted projects, networks, and paths. This is a defense-in-depth control for environments where a leaked credential or overpowered identity could be used from an untrusted location.

For example, imagine `devpolaris-orders-runtime` has the right IAM role on `orders-db-password`. IAM alone checks the principal and the resource. A VPC Service Controls perimeter can add a boundary so supported Google API requests to protected resources stay inside the trusted service perimeter unless an explicit ingress or egress rule allows the path.

Secret Manager payload access is a data-exfiltration risk, so perimeter design sits close to runtime secret design. A person or workload with `roles/secretmanager.secretAccessor` can retrieve sensitive values, so high-risk production projects often combine narrow IAM with perimeter controls, private connectivity patterns, and alerting on access from unusual places.

VPC Service Controls works alongside careful IAM. The orders API service account should still have access only to `orders-db-password`, and the rotation worker should still have only the lifecycle permissions it needs. The perimeter reduces where supported API access can happen, while IAM reduces what each identity can do.

## Runtime Evidence Without Printing Payloads
<!-- section-summary: Good evidence proves which version the service used through metadata, audit logs, health checks, and database behavior rather than secret values. -->

The last piece is evidence. During a rotation, people often feel tempted to prove the new value by running `gcloud secrets versions access` and pasting the result somewhere. That creates a new leak, and the leak often lands in the exact places auditors review later: terminals, logs, screenshots, tickets, and chat messages.

A better evidence trail proves the secret version and runtime behavior through metadata. The team can show that alias `current` points to version `8`, that Cloud Run deployed a new revision for `devpolaris-orders-api`, that the service account accessed the right secret version, that the database saw healthy connections from the app, and that customer-facing error rates stayed normal.

Useful evidence for the release record should be boring and repeatable. The commands below show the alias target and Cloud Run revision state while keeping the payload out of the terminal output.

```bash
gcloud secrets describe orders-db-password \
  --format="value(versionAliases.current)"

gcloud run revisions list \
  --service=devpolaris-orders-api \
  --region=europe-west2 \
  --format="table(metadata.name,status.conditions[0].status,traffic.percent)"
```

Run the first command to prove which version the `current` alias points to without printing the password. Run the second command to prove which Cloud Run revisions are serving traffic after the alias move. The `--format` flags keep the release evidence small enough to paste into a ticket safely.

Expected output might look like this:

```yaml
8

NAME                                  STATUS  TRAFFIC
devpolaris-orders-api-00017-bxq       True    100
devpolaris-orders-api-00016-pdk       True    0
```

The audit log evidence should focus on `AccessSecretVersion` entries for the runtime service account and the expected version. Secret Manager audit logs use the service name `secretmanager.googleapis.com`, and `AccessSecretVersion` is the method that reads the payload. The log entry gives the caller, resource, method, timestamp, and request context without needing the password value in the release ticket.

```bash
gcloud logging read '
protoPayload.serviceName="secretmanager.googleapis.com"
protoPayload.methodName="google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion"
protoPayload.resourceName:"secrets/orders-db-password/versions/8"
protoPayload.authenticationInfo.principalEmail="devpolaris-orders-runtime@PROJECT_ID.iam.gserviceaccount.com"
' \
  --limit=20 \
  --format=json
```

The logging command is read-only evidence collection. The filter selects Secret Manager payload reads for version `8` by the runtime service account, `--limit` keeps the output bounded, and `--format=json` preserves fields for audit review.

A useful result should show the method, caller, resource, and timestamp while omitting the payload:

```json
[
  {
    "protoPayload": {
      "authenticationInfo": {
        "principalEmail": "devpolaris-orders-runtime@PROJECT_ID.iam.gserviceaccount.com"
      },
      "methodName": "google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion",
      "resourceName": "projects/PROJECT_ID/secrets/orders-db-password/versions/8"
    },
    "timestamp": "2026-07-01T09:18:44.219Z"
  }
]
```

The database verification should also avoid payloads. For a PostgreSQL-style database, the release record can include a query that proves the application connected as the expected database user and stayed healthy after the traffic shift. The result should show connection metadata and counts only.

```sql
select
  usename,
  application_name,
  state,
  count(*) as connection_count
from pg_stat_activity
where application_name = 'devpolaris-orders-api'
group by usename, application_name, state;
```

This SQL query runs in the database, not in Secret Manager. It verifies runtime behavior after the secret alias moved by counting active application connections. A healthy result shows the expected application name and database user without exposing the password:

| usename | application_name | state | connection_count |
|---|---|---|---:|
| orders_app_b | devpolaris-orders-api | active | 12 |
| orders_app_b | devpolaris-orders-api | idle | 38 |

![Secret rotation evidence](/content-assets/articles/article-cloud-providers-gcp-identity-security-secret-manager-encryption-basics/secret-rotation-evidence.png)
*Good rotation evidence proves the alias target, serving revision, audit-log caller, and database behavior while keeping the secret value out of human-readable artifacts.*

That is strong runtime evidence. It shows the service connected after the alias moved to version `8`, it gives operations a concrete query to repeat, and it leaves the secret payload out of every human-readable artifact.

## Putting It All Together
<!-- section-summary: Safe runtime secret handling combines versioned storage, narrow IAM, controlled rollout, lifecycle recovery, encryption choices, perimeter controls, and payload-free evidence. -->

The `devpolaris-orders-api` database password rotation works because every layer has a clear job. Secret Manager stores `orders-db-password`, versions `7` and `8` hold immutable payloads, IAM grants the Cloud Run runtime service account accessor access on only that secret, and the `current` alias turns the version change into an explicit release step.

The rotation workflow also has recovery space. Pub/Sub sends the rotation signal, automation creates and verifies the new version, Cloud Run rolls a new revision, the database verification query proves the service is connected, and version `7` stays available until the rollout has soaked. Delayed destruction gives the final cleanup a recovery window before old material disappears permanently.

Security controls then wrap the workflow. CMEK gives key ownership when compliance requires it, VPC Service Controls can add a perimeter around supported Google API access paths, and audit logs show who accessed which secret version. The team can prove the runtime used version `8` without printing, copying, or screenshotting the password.

That is the practical goal for runtime secrets. The application gets the value it needs, operators get a repeatable release and rollback path, and security gets evidence that protects the secret instead of spreading it.

---

**References**

- [Google Cloud: Secret Manager overview](https://docs.cloud.google.com/secret-manager/docs/overview) - Defines secrets, secret versions, default encryption, IAM access, replication, and rotation capabilities.
- [Google Cloud: Access a secret version](https://docs.cloud.google.com/secret-manager/docs/access-secret-version) - Documents accessing versions by version ID, assigned alias, or `latest`, and the Secret Accessor role.
- [Google Cloud: Assign an alias to a secret version](https://docs.cloud.google.com/secret-manager/docs/assign-alias-to-secret-version) - Documents custom version aliases and alias naming rules.
- [Google Cloud: Configure secrets for Cloud Run services](https://docs.cloud.google.com/run/docs/configuring/services/secrets) - Documents Cloud Run secret environment variables, file mounts, service identity access, and runtime behavior.
- [Google Cloud: Use Secret Manager with other products](https://docs.cloud.google.com/secret-manager/docs/using-other-products) - Summarizes Cloud Run, Compute Engine, and GKE integration paths.
- [Google Cloud: Access the Secret Manager API](https://docs.cloud.google.com/secret-manager/docs/accessing-the-api) - Documents Compute Engine and GKE OAuth scope requirements for Secret Manager API access.
- [Google Cloud: Use Secret Manager add-on with GKE](https://docs.cloud.google.com/secret-manager/docs/secret-manager-managed-csi-component) - Documents the GKE add-on for mounting Secret Manager secrets as pod volumes.
- [Google Cloud: Access control with IAM](https://docs.cloud.google.com/secret-manager/docs/access-control) - Lists Secret Manager roles, lowest-level grant scopes, and least-privilege guidance.
- [Google Cloud: Set up notifications on a secret](https://docs.cloud.google.com/secret-manager/docs/event-notifications) - Documents Pub/Sub event notifications, event types, and the `SECRET_ROTATE` event.
- [Google Cloud: Create rotation schedules in Secret Manager](https://docs.cloud.google.com/secret-manager/docs/secret-rotation) - Documents `next_rotation_time`, `rotation_period`, Pub/Sub topics, and rotation schedule setup.
- [Google Cloud: About rotation schedules](https://docs.cloud.google.com/secret-manager/docs/rotation-recommendations) - Gives rotation recommendations for binding versions, rolling out new versions, retries, and cleanup.
- [Google Cloud: Delay destruction of secret versions](https://docs.cloud.google.com/secret-manager/docs/delay-destruction-of-secret-versions) - Documents delayed destruction, recovery during the delay window, and restore behavior.
- [Google Cloud: Enable CMEK for Secret Manager](https://docs.cloud.google.com/secret-manager/docs/cmek) - Explains customer-managed encryption keys, Cloud KMS location requirements, and service agent permissions.
- [Google Cloud: VPC Service Controls overview](https://docs.cloud.google.com/vpc-service-controls/docs/overview) - Explains service perimeters, trusted boundaries, and data exfiltration controls for supported Google-managed services.
- [Google Cloud: Secret Manager audit logging](https://docs.cloud.google.com/secret-manager/docs/audit-logging) - Documents audit log service names, method names, and `AccessSecretVersion` logging.
