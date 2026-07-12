---
title: "Service Accounts and Workload Identity"
description: "Use service accounts, runtime identity, ADC, impersonation, keys, and Workload Identity Federation so software can call Google Cloud APIs safely."
overview: "Software needs its own Google Cloud identity. A service account can act as the principal making API calls and also as the resource that controls who may attach, impersonate, or manage that identity."
tags: ["gcp", "service-accounts", "adc", "workload-identity"]
order: 2
id: article-cloud-providers-gcp-identity-security-service-accounts-apps-automation
aliases:
  - service-accounts-for-apps-and-automation
  - application-default-credentials-and-local-development
  - article-cloud-providers-gcp-identity-security-application-default-credentials-local-development
  - cloud-providers/gcp/identity-security/service-accounts-for-apps-and-automation.md
  - cloud-providers/gcp/identity-security/application-default-credentials-and-local-development.md
---

## Table of Contents

1. [Software Needs Its Own Identity](#software-needs-its-own-identity)
2. [Service Accounts as Principals and Resources](#service-accounts-as-principals-and-resources)
3. [Runtime Identity for Running Workloads](#runtime-identity-for-running-workloads)
4. [Application Default Credentials](#application-default-credentials)
5. [Service Account Impersonation](#service-account-impersonation)
6. [Keys and the Legacy Exception](#keys-and-the-legacy-exception)
7. [Workload Identity Federation](#workload-identity-federation)
8. [How AWS Readers Can Map the Ideas](#how-aws-readers-can-map-the-ideas)
9. [Debugging the Caller Identity](#debugging-the-caller-identity)
10. [References](#references)

## Software Needs Its Own Identity
<!-- section-summary: A service account gives software a dedicated caller identity instead of borrowing a human account. -->

Every production workload eventually needs to call something else. A Cloud Run app reads a bucket, a nightly backup job writes an archive, and a build pipeline deploys a new revision. Google Cloud still needs to answer the same access question each time: **which identity is calling this API?**

A human account is a poor long-term answer for running software. A person may change teams, lose a laptop, rotate credentials, leave the company, or have access that includes far more than the workload needs. Production software needs an identity that belongs to the workload and can be reviewed as part of the workload.

A **service account** is a Google Cloud identity for software, automation, and workloads. It has an email-like name such as `photo-uploader@media-prod.iam.gserviceaccount.com`. As your app calls Secret Manager, Cloud Storage, Pub/Sub, or another Google API, IAM can check that service account instead of checking a developer's personal user account.

The examples here follow three normal production jobs. A Cloud Run photo app reads and writes one bucket. A nightly backup job writes database dumps into an archive bucket. A CI/CD pipeline deploys a Cloud Run service. Each job needs a clear identity and a small set of roles.

![Runtime and deploy identity split](/content-assets/articles/article-cloud-providers-gcp-identity-security-service-accounts-apps-automation/runtime-deploy-identity-split.png)
*Runtime identity and deploy identity solve different problems. One calls APIs after code starts; the other changes deployed infrastructure.*

## Service Accounts as Principals and Resources
<!-- section-summary: A service account can receive roles as a principal, and it has its own IAM policy as a resource. -->

A service account has two views in Google Cloud. As a **principal**, it can receive roles on resources. As a **resource**, it has an IAM policy that controls who can attach it to a runtime, impersonate it, administer it, or create keys for it.

The principal side answers, "What can this software identity access?" If `photo-uploader@media-prod.iam.gserviceaccount.com` needs to create objects in `prod-photo-uploads`, you grant that service account a Storage role on that bucket.

The resource side answers, "Who can use this service account?" If `deploy-bot@media-prod.iam.gserviceaccount.com` needs to deploy Cloud Run revisions that run as `photo-uploader@...`, the deploy bot needs permission on the `photo-uploader` service account resource.

| View | Plain question | Example |
|---|---|---|
| Service account as principal | What may this workload access? | `photo-uploader@...` receives bucket object-creation access. |
| Service account as resource | Who may use this identity? | `deploy-bot@...` may attach `photo-uploader@...` to Cloud Run. |

Create a dedicated runtime service account before granting runtime access:

```bash
gcloud iam service-accounts create photo-uploader \
  --project=media-prod \
  --display-name="Photo uploader runtime"
```

- `photo-uploader` sets the service account ID used in the email address.
- `--project` places the service account resource in the production project.
- `--display-name` gives reviewers a human-readable hint about the workload.

Grant the runtime service account access to one bucket after the bucket exists:

```bash
gcloud storage buckets add-iam-policy-binding gs://prod-photo-uploads \
  --member="serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

- The bucket is the resource receiving the allow-policy binding.
- The member is the service account acting as the principal.
- The role lets the uploader create objects without giving it broad storage administration.

Give the deploy identity permission to attach the runtime identity to Cloud Run:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  photo-uploader@media-prod.iam.gserviceaccount.com \
  --project=media-prod \
  --member="serviceAccount:deploy-bot@media-prod.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

- The first argument is the service account resource being controlled.
- `deploy-bot@...` is the principal that may attach the runtime identity.
- `roles/iam.serviceAccountUser` covers the act-as path used by many deployment flows.

## Runtime Identity for Running Workloads
<!-- section-summary: Runtime identity is the service account attached to the compute resource that runs your code. -->

**Runtime identity** is the identity your code uses after it starts. In Cloud Run, that identity is the service account attached to the Cloud Run service. In Compute Engine, it is the service account attached to the VM. In GKE, a pod can use a Kubernetes ServiceAccount mapped through Workload Identity Federation for GKE.

For the photo app, Cloud Run should run as `photo-uploader@media-prod.iam.gserviceaccount.com`. That account needs object creation in the upload bucket and perhaps secret access for one webhook signing key. It should not deploy services, edit IAM, or administer unrelated buckets.

Deploy Cloud Run with the named runtime identity:

```bash
gcloud run deploy photo-uploader \
  --project=media-prod \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/media-prod/apps/photo-uploader:2026-07-04 \
  --service-account=photo-uploader@media-prod.iam.gserviceaccount.com
```

- `--image` selects the container artifact that Cloud Run will run.
- `--service-account` sets the runtime identity for the new revision.
- The caller running the deploy also needs permission to update Cloud Run and attach this service account.

Healthy output should name the deployed service and revision:

```yaml
Deploying container to Cloud Run service [photo-uploader] in project [media-prod] region [us-central1]
OK Deploying new service revision... Done.
Service [photo-uploader] revision [photo-uploader-00012-vx7] has been deployed.
```

- The revision line confirms that Cloud Run created a new runtime version.
- The project and region help you catch accidental deploys to staging or the wrong region.
- The service account choice is visible in Cloud Run service details and in later audit evidence.

A nightly backup job follows the same pattern. The job can run as `db-backup-writer@media-prod.iam.gserviceaccount.com`, receive permission to write only to `gs://prod-db-backups`, and keep database export permissions separate from the public app's runtime identity.

## Application Default Credentials
<!-- section-summary: ADC lets Google client libraries find credentials from the environment without hardcoding a key file in application code. -->

**Application Default Credentials**, or **ADC**, is the lookup strategy Google authentication libraries use to find credentials for your code. The code creates a normal Google Cloud client, and the library finds credentials from the environment around the code.

ADC matters because the same app can run in several places. On Cloud Run, ADC can use the attached service account. On your laptop, ADC can use local developer credentials or local impersonation credentials. In CI/CD, ADC can use a Workload Identity Federation credential configuration. The application code should not need a different authentication branch for each place.

```js
import {Storage} from "@google-cloud/storage";

const storage = new Storage();

await storage
  .bucket("prod-photo-uploads")
  .file("customers/8842/profile.jpg")
  .save(imageBuffer, {
    contentType: "image/jpeg",
  });
```

- `new Storage()` lets the client library use ADC instead of a hand-loaded key file.
- The bucket name still appears in code or config because it is application data, not a credential.
- The runtime service account needs IAM access to create the object, or the call fails.

![ADC credential lookup](/content-assets/articles/article-cloud-providers-gcp-identity-security-service-accounts-apps-automation/adc-credential-lookup.png)
*ADC keeps credential lookup outside the application code, while IAM still decides what the caller can do.*

For local development, a developer can set up ADC with impersonation so local code behaves more like Cloud Run:

```bash
gcloud auth application-default login \
  --impersonate-service-account=photo-uploader@media-prod.iam.gserviceaccount.com
```

- The developer signs in with a human account first.
- IAM checks whether that human may impersonate the target service account.
- The local ADC file requests short-lived credentials for the service account during supported client library calls.

The expected setup message should mention the impersonated service account:

```yaml
Credentials saved to file: [/Users/priya/.config/gcloud/application_default_credentials.json]
These credentials will impersonate service account [photo-uploader@media-prod.iam.gserviceaccount.com].
```

- The file path tells you where ADC stored local configuration.
- The impersonation line confirms that local code will use the workload identity instead of broad personal access.
- Local ADC files still need normal workstation protection because they can request credentials.

## Service Account Impersonation
<!-- section-summary: Impersonation lets one authenticated principal request short-lived credentials for a service account after IAM approves the handoff. -->

**Service account impersonation** means an already-authenticated principal asks Google Cloud for short-lived credentials for a service account. The source principal might be a human user, a deployer service account, or a federated CI/CD identity. Google Cloud only issues the credentials if IAM allows the handoff.

Impersonation is useful for two common paths. A developer can debug local code with the same identity that Cloud Run uses. A build pipeline can deploy as `deploy-bot@...` without storing a JSON private key in the CI system.

The smallest local-debug grant lives on the target service account resource:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  photo-uploader@media-prod.iam.gserviceaccount.com \
  --project=media-prod \
  --member="user:priya@example.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

- `user:priya@example.com` is the **source principal**. Priya is already authenticated to Google Cloud.
- `photo-uploader@media-prod.iam.gserviceaccount.com` is the **target service account**. IAM checks whether Priya can mint short-lived credentials for that service account.
- `roles/iam.serviceAccountTokenCreator` allows short-lived token creation and use of the `--impersonate-service-account` flag. It should be granted on the service account that needs impersonation, not casually across every service account in the project.

The policy output should show Priya only on the service account that matches the debug task:

```yaml
bindings:
- members:
  - user:priya@example.com
  role: roles/iam.serviceAccountTokenCreator
etag: BwYh5DbtF4I=
```

If a CI service account needs the same handoff, the source principal changes to `serviceAccount:deploy-bot@ci-prod.iam.gserviceaccount.com`. The target service account stays `photo-uploader@...` only if the pipeline truly needs to test or deploy as the runtime identity.

For a one-command check, a developer can upload a tiny probe object as the runtime service account. This matches an object-creator grant because it proves `storage.objects.create` instead of requiring object listing permission:

```bash
printf 'impersonation probe\n' > /tmp/photo-uploader-probe.txt

gcloud storage cp /tmp/photo-uploader-probe.txt \
  gs://prod-photo-uploads/impersonation-probes/priya-20260704.txt \
  --impersonate-service-account=photo-uploader@media-prod.iam.gserviceaccount.com
```

- The human running the command must have permission to impersonate `photo-uploader@...`.
- The storage request is authorized as the service account, so bucket IAM still controls the result.
- The probe writes one known object path; it does not prove list or read access.
- Audit logs can show service account delegation details for supported flows.

Expected output should show one completed upload:

```console
Copying file:///tmp/photo-uploader-probe.txt to gs://prod-photo-uploads/impersonation-probes/priya-20260704.txt
  Completed files 1/1 | 22B/22B
```

- Success means the impersonation path and object-create permission both worked.
- A failure can come from missing impersonation permission or missing bucket access, so check both sides.
- The command should not require a downloaded service account key.

Two roles appear often. `roles/iam.serviceAccountUser` lets a principal attach a service account to a runtime such as Cloud Run or Compute Engine. `roles/iam.serviceAccountTokenCreator` lets a principal mint short-lived tokens for a service account through the IAM Credentials API. Use the role that matches the handoff you need rather than granting both by habit.

## Keys and the Legacy Exception
<!-- section-summary: Service account keys are long-lived private credentials, so keyless runtime identity and impersonation are safer defaults. -->

A **service account key** is a long-lived private credential for a service account. Older systems often used a downloaded JSON key file so code outside Google Cloud could authenticate as a service account. That pattern is risky because anyone who gets the file can use it until the key is disabled, deleted, or expires through organization policy controls.

Modern Google Cloud designs prefer keyless paths. Workloads inside Google Cloud use attached runtime identities. Developers and automation use impersonation. External CI/CD systems use Workload Identity Federation. Those paths create short-lived credentials and give audit logs a better story about the source identity.

Keys still show up during migrations. A legacy backup appliance may only understand JSON key files, or a third-party integration may have no federation support yet. Treat those cases as exceptions with a named owner, a rotation plan, a storage location, and monitoring for key use.

If you must inspect existing keys for one service account, use a read-only command first:

```bash
gcloud iam service-accounts keys list \
  --iam-account=legacy-backup@media-prod.iam.gserviceaccount.com \
  --project=media-prod
```

- The command lists key metadata, not the private key material.
- `--iam-account` targets the service account resource being reviewed.
- The result should feed a migration plan toward impersonation or federation if possible.

Example output should show key IDs and creation times:

```yaml
KEY_ID: 8f3c1a2b9d...
CREATED_AT: 2025-10-18T14:07:31Z
EXPIRES_AT:
DISABLED: False
```

- An empty `EXPIRES_AT` value means the key lacks a built-in expiration in this output.
- Old active keys deserve review because they may be copied into scripts, CI variables, or vendor portals.
- Disabling a key should follow a planned test path so a hidden dependency does not break production.

## Workload Identity Federation
<!-- section-summary: Workload Identity Federation lets external workloads exchange trusted external identity for short-lived Google Cloud credentials. -->

**Workload Identity Federation** lets a workload outside Google Cloud use a trusted external identity to get short-lived Google Cloud credentials. The external workload might run in GitHub Actions, GitLab CI, another cloud provider, or an on-premises platform. The key idea is that Google Cloud trusts a token from that external system and maps it to a Google Cloud identity path.

For the photo app, the build pipeline can deploy Cloud Run without a service account key. GitHub Actions receives an OIDC token for one approved repository and branch. Google Cloud validates that token through a workload identity pool and provider. The workflow then impersonates `deploy-bot@media-prod.iam.gserviceaccount.com` for the deployment.

![Keyless CI/CD federation](/content-assets/articles/article-cloud-providers-gcp-identity-security-service-accounts-apps-automation/keyless-cicd-federation.png)
*A keyless CI/CD path exchanges the CI provider's identity token for short-lived Google credentials, then deploys through a narrow service account.*

A practical GitHub Actions setup has three pieces: a pool, an OIDC provider, and a binding on the deploy service account. The pool groups external identities. The provider tells Google Cloud how to trust GitHub's token. The service-account binding names which repository identity can impersonate `deploy-bot`.

```bash
PROJECT_NUMBER="$(gcloud projects describe media-prod --format='value(projectNumber)')"

gcloud iam workload-identity-pools create github-deploy \
  --project=media-prod \
  --location=global \
  --display-name="GitHub deploy"

gcloud iam workload-identity-pools providers create-oidc github-actions \
  --project=media-prod \
  --location=global \
  --workload-identity-pool=github-deploy \
  --issuer-uri="https://token.actions.githubusercontent.com/" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition='assertion.repository=="northstar/photo-app" && assertion.ref=="refs/heads/main"'

gcloud iam service-accounts add-iam-policy-binding \
  deploy-bot@media-prod.iam.gserviceaccount.com \
  --project=media-prod \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-deploy/attribute.repository/northstar/photo-app"
```

- The provider trusts GitHub's issuer and maps stable token claims into Google Cloud attributes.
- The attribute condition limits the provider to one repository and the `main` branch.
- The service-account binding lets matching external identities impersonate `deploy-bot`; `deploy-bot` still needs its own deployment roles on Cloud Run, Artifact Registry, and other deployment resources.
- Use the project number in the principal identifier. Google Cloud's workload identity member strings use project numbers for pools.

The workflow then asks GitHub for an ID token and uses the provider plus service account:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: actions/checkout@v4
  - id: auth
    uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/123456789012/locations/global/workloadIdentityPools/github-deploy/providers/github-actions
      service_account: deploy-bot@media-prod.iam.gserviceaccount.com
```

Healthy evidence should be simple: the workflow log shows that the auth step created Google credentials, the Cloud Run deployment audit log names `deploy-bot@media-prod.iam.gserviceaccount.com`, and Service Account Credentials or Security Token Service audit logs show the external principal path from the workload identity pool.

The production review should ask a few practical questions:

| Question | Why it matters |
|---|---|
| Which external identity provider is trusted? | A pool should trust the CI provider your team actually uses. |
| Which repository, branch, or workflow can use the path? | Conditions prevent every workflow in an organization from deploying production. |
| Which service account can be impersonated? | The deploy identity should have deployment access, not runtime data access. |
| How long do the credentials last? | Short-lived credentials reduce the damage from token exposure. |

GKE has a related path called Workload Identity Federation for GKE. A Kubernetes ServiceAccount can map to IAM access, so a pod calls Google Cloud APIs without using the node's service account and without mounting a JSON key. That keeps pod identity closer to the application that needs access.

![GKE workload identity choices](/content-assets/articles/article-cloud-providers-gcp-identity-security-service-accounts-apps-automation/gke-workload-identity-choices.png)
*GKE workload identity keeps pod-level access separate from the node identity and from downloaded key files.*

## How AWS Readers Can Map the Ideas
<!-- section-summary: GCP service accounts cover the workload-identity job that AWS IAM roles often cover, with different attachment and impersonation mechanics. -->

AWS readers can map a GCP service account to the workload identity job often handled by an AWS IAM role attached to EC2, Lambda, ECS, or EKS. In both clouds, software should receive short-lived, scoped credentials instead of a copied long-lived secret.

The handoff mechanics differ. In AWS, workloads often receive credentials through STS role assumption. In Google Cloud, code inside managed runtimes usually uses an attached service account through ADC. A human, CI job, or external workload can also impersonate a service account after IAM allows it.

Workload Identity Federation is the closest GCP idea to using external OIDC and STS-style token exchange for keyless CI/CD. The goal is the same: trust the external workload identity, issue short-lived cloud credentials, and avoid storing static cloud keys in the pipeline.

## Debugging the Caller Identity
<!-- section-summary: Service account failures usually come from the wrong runtime identity, missing resource access, or missing impersonation permission. -->

For a workload with `403 PERMISSION_DENIED`, first confirm the caller. In Cloud Run, check the service account attached to the service revision. In Compute Engine, check the VM's attached service account and OAuth scopes. In GKE, check the Kubernetes ServiceAccount and the workload identity mapping.

For Cloud Run, export the current service YAML or query the service account field directly:

```bash
gcloud run services describe photo-uploader \
  --project=media-prod \
  --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)'
```

```console
photo-uploader@media-prod.iam.gserviceaccount.com
```

- This is the runtime identity the container uses for Google Cloud API calls.
- If the output shows the default Compute Engine service account, the bucket policy may be correct while the service is running as the wrong caller.
- A new service account setting creates a new Cloud Run revision, so compare the active traffic revision with the revision that has the expected identity.

Next, check whether the service account has the resource role it needs. The photo uploader may run as the right service account and still fail if bucket IAM grants access to `photo-uploader-staging@...` or to the deploy bot instead of the runtime account.

Check the target service account's own IAM policy for problems involving attachment or impersonation:

```bash
gcloud iam service-accounts get-iam-policy \
  photo-uploader@media-prod.iam.gserviceaccount.com \
  --project=media-prod \
  --format=yaml
```

```yaml
bindings:
- members:
  - user:priya@example.com
  role: roles/iam.serviceAccountTokenCreator
- members:
  - serviceAccount:deploy-bot@ci-prod.iam.gserviceaccount.com
  role: roles/iam.serviceAccountUser
```

- `roles/iam.serviceAccountTokenCreator` answers who can mint short-lived credentials for local tests or CLI impersonation.
- `roles/iam.serviceAccountUser` answers who can attach the service account to a runtime during deployment.
- These bindings live on the service account resource. They do not grant bucket access by themselves.

Finally, check the handoff permission. A deployer can fail before the app starts if it lacks permission to attach the runtime service account. A developer can fail local impersonation if they lack token-creation permission on the target service account. These errors look similar from far away, so keep the two views separate: service account as principal, and service account as resource.

An impersonation test should prove both sides of the path. First, confirm the signed-in source principal:

```bash
gcloud auth list \
  --filter='status:ACTIVE' \
  --format='value(account)'
```

```console
priya@example.com
```

Then call a harmless create-object probe through the target service account:

```bash
printf 'caller identity probe\n' > /tmp/photo-uploader-debug.txt

gcloud storage cp /tmp/photo-uploader-debug.txt \
  gs://prod-photo-uploads/debug-probes/priya-20260704.txt \
  --impersonate-service-account=photo-uploader@media-prod.iam.gserviceaccount.com
```

```console
Copying file:///tmp/photo-uploader-debug.txt to gs://prod-photo-uploads/debug-probes/priya-20260704.txt
  Completed files 1/1 | 22B/22B
```

- If impersonation fails before the storage call, fix the target service account policy.
- If impersonation succeeds and storage fails, fix the resource policy on the bucket or project.
- If the probe succeeds but a list command still fails, the bucket probably grants create without list, which can be a valid least-privilege design.
- If both the probe and policy checks succeed locally while Cloud Run still fails, the deployed revision is likely using a different runtime identity or a different bucket name.

## References

- [Service accounts overview](https://docs.cloud.google.com/iam/docs/service-account-overview) - Explains service accounts and their lifecycle considerations.
- [Best practices for using service accounts securely](https://docs.cloud.google.com/iam/docs/best-practices-service-accounts) - Covers secure service account management and least-privilege guidance.
- [Roles for service account authentication](https://docs.cloud.google.com/iam/docs/service-account-permissions) - Documents attaching, impersonating, and generating tokens for service accounts.
- [Configure service identity for Cloud Run services](https://docs.cloud.google.com/run/docs/configuring/services/service-identity) - Documents service identity, service-account attachment, and Cloud Run service-account checks.
- [How Application Default Credentials works](https://docs.cloud.google.com/docs/authentication/application-default-credentials) - Explains ADC lookup behavior across environments.
- [Use service account impersonation](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation) - Documents impersonation for local ADC and command workflows.
- [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation) - Describes keyless access for external workloads.
- [Configure Workload Identity Federation with deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) - Shows GitHub Actions, GitLab, Azure DevOps, and service-account impersonation setup for CI/CD.
- [Best practices for managing service account keys](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys) - Explains service account key risks and management guidance.
