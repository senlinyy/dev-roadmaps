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

1. [Why Does Software Need Its Own Identity?](#why-does-software-need-its-own-identity)
2. [How Is a Service Account Both a Principal and a Resource?](#how-is-a-service-account-both-a-principal-and-a-resource)
3. [How Do Metadata Servers and ADC Find Short-Lived Credentials?](#how-do-metadata-servers-and-adc-find-short-lived-credentials)
4. [How Does Service Account Impersonation Differ from Attaching an Identity?](#how-does-service-account-impersonation-differ-from-attaching-an-identity)
5. [Why Should Service Account Keys Be an Exception?](#why-should-service-account-keys-be-an-exception)
6. [How Does Workload Identity Federation Remove Cross-Environment Keys?](#how-does-workload-identity-federation-remove-cross-environment-keys)
7. [How Should AWS Readers Translate These Identity Concepts?](#how-should-aws-readers-translate-these-identity-concepts)
8. [How Do You Debug the Caller and Choose the Safest Credential Path?](#how-do-you-debug-the-caller-and-choose-the-safest-credential-path)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Every production workload eventually needs to call something else. A Cloud Run app reads a bucket, a nightly payment worker writes an archive, and a build pipeline deploys a new revision. Google Cloud still needs to answer the same access question each time: **which identity is calling this API?**

A human account is a poor long-term answer for running software. A person may change teams, lose a laptop, rotate credentials, leave the company, or have access that includes far more than the workload needs. Production software needs an identity that belongs to the workload and can be reviewed as part of the workload.

A **service account** is a Google Cloud identity for software, automation, and workloads. It has an email-like name such as `checkout-api@acme-prod.iam.gserviceaccount.com`. As your app calls Secret Manager, Cloud Storage, Pub/Sub, or another Google API, IAM can check that service account instead of checking a developer's personal user account.

Keep these questions in view as you work through the lesson:

1. **Why Does Software Need Its Own Identity?**
2. **How Is a Service Account Both a Principal and a Resource?**
3. **How Do Metadata Servers and ADC Find Short-Lived Credentials?**
4. **How Does Service Account Impersonation Differ from Attaching an Identity?**
5. **Why Should Service Account Keys Be an Exception?**
6. **How Does Workload Identity Federation Remove Cross-Environment Keys?**
7. **How Should AWS Readers Translate These Identity Concepts?**
8. **How Do You Debug the Caller and Choose the Safest Credential Path?**

## Why Does Software Need Its Own Identity?
<!-- section-summary: A service account gives software a dedicated caller identity instead of borrowing a human account. -->

The examples here follow three normal production jobs. A Cloud Run checkout API reads a secret, writes order objects, and publishes messages. A payment worker reads jobs and a payment secret. A reporting service reads analytics data. Each job needs a clear identity and a small set of roles.

Start by separating identity, credential, and permission. The identity is the stable answer to "who is this software?", such as `checkout-api@acme-prod.iam.gserviceaccount.com`. A credential is temporary proof of that identity, such as an OAuth access token. IAM roles decide what the identity may do on a target resource. A service account is therefore not the token and not the role: it obtains or is represented by credentials, and it receives roles.

That separation lets security boundaries match workloads. `checkout-api` may read secrets, write order objects, and publish messages. `payment-worker` may read payment jobs and access a payment secret. `report-generator` may read BigQuery without touching payment credentials. If all three share one powerful account, compromise of any workload exposes every permission. Dedicated identities let IAM describe each workload's actual job.

The preferred outcome is a **credentialless application** in the operational sense. Cryptographic credentials still exist, but the application does not own a long-lived private key. Its execution environment establishes identity, the platform issues short-lived proof, the library uses it, and the proof expires while the service account identity remains stable.

## How Is a Service Account Both a Principal and a Resource?
<!-- section-summary: A service account can receive roles as a principal, and it has its own IAM policy as a resource. -->

A service account has two views in Google Cloud. As a **principal**, it can receive roles on resources. As a **resource**, it has an IAM policy that controls who can attach it to a runtime, impersonate it, administer it, or create keys for it.

The principal side answers, "What can this software identity access?" If `checkout-api@acme-prod.iam.gserviceaccount.com` needs to create objects in `orders-prod`, you grant that service account a Storage role on that bucket.

The resource side answers, "Who can use this service account?" If `deploy-bot@acme-prod.iam.gserviceaccount.com` needs to deploy Cloud Run revisions that run as `checkout-api@...`, the deploy bot needs permission on the `checkout-api` service account resource.

| View | Plain question | Example |
|---|---|---|
| Service account as principal | What may this workload access? | `checkout-api@...` receives bucket object-creation access. |
| Service account as resource | Who may use this identity? | `deploy-bot@...` may attach `checkout-api@...` to Cloud Run. |

These two directions must be reviewed separately. Granting `checkout-api` Secret Accessor answers what calls made as that service account can do. Granting Alice `iam.serviceAccounts.actAs` on `checkout-api` answers whether Alice can configure a supported workload to run as it. A person who may attach a powerful service account can cause that workload to exercise the account's downstream permissions, so attachment rights are themselves sensitive.

Create a dedicated runtime service account before granting runtime access:

```bash
gcloud iam service-accounts create checkout-api \
  --project=acme-prod \
  --display-name="Checkout API runtime"
```

- `checkout-api` sets the service account ID used in the email address.
- `--project` places the service account resource in the production project.
- `--display-name` gives reviewers a human-readable hint about the workload.

Grant the runtime service account access to one bucket after the bucket exists:

```bash
gcloud storage buckets add-iam-policy-binding gs://orders-prod \
  --member="serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

- The bucket is the resource receiving the allow-policy binding.
- The member is the service account acting as the principal.
- The role lets the checkout API create order objects without giving it broad storage administration.

Give the deploy identity permission to attach the runtime identity to Cloud Run:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  checkout-api@acme-prod.iam.gserviceaccount.com \
  --project=acme-prod \
  --member="serviceAccount:deploy-bot@acme-prod.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

- The first argument is the service account resource being controlled.
- `deploy-bot@...` is the principal that may attach the runtime identity.
- `roles/iam.serviceAccountUser` covers the act-as path used by many deployment flows.

### Runtime Identity Attaches the Service Account to Compute
<!-- section-summary: Runtime identity is the service account attached to the compute resource that runs your code. -->

**Runtime identity** is the identity your code uses after it starts. In Cloud Run, that identity is the service account attached to the Cloud Run service. In Compute Engine, it is the service account attached to the VM. In GKE, a pod can use a Kubernetes ServiceAccount mapped through Workload Identity Federation for GKE.

For the checkout application, Cloud Run should run as `checkout-api@acme-prod.iam.gserviceaccount.com`. That account needs object creation in the upload bucket and perhaps secret access for one webhook signing key. It should not deploy services, edit IAM, or administer unrelated buckets.

Deploy Cloud Run with the named runtime identity:

```bash
gcloud run deploy checkout-api \
  --project=acme-prod \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/acme-prod/apps/checkout-api:2026-07-04 \
  --service-account=checkout-api@acme-prod.iam.gserviceaccount.com
```

- `--image` selects the container artifact that Cloud Run will run.
- `--service-account` sets the runtime identity for the new revision.
- The caller running the deploy also needs permission to update Cloud Run and attach this service account.

Healthy output should name the deployed service and revision:

```yaml
Deploying container to Cloud Run service [checkout-api] in project [acme-prod] region [us-central1]
OK Deploying new service revision... Done.
Service [checkout-api] revision [checkout-api-00012-vx7] has been deployed.
```

- The revision line confirms that Cloud Run created a new runtime version.
- The project and region help you catch accidental deploys to staging or the wrong region.
- The service account choice is visible in Cloud Run service details and in later audit evidence.

A nightly payment worker follows the same pattern. The job can run as `payment-worker@acme-prod.iam.gserviceaccount.com`, receive permission to write only to `gs://payment-jobs`, and keep database export permissions separate from the public app's runtime identity.

Do not treat a provider-created default service account as the correct identity for every workload. A default may be convenient during a first test, but checkout, payments, and reporting have different security boundaries. Dedicated, minimally privileged accounts make policy and audit records express workload purpose. Newer Google Cloud organizations also receive stronger default safeguards against automatic broad grants and key creation, reinforcing the direction toward purpose-built, keyless identities.

After attachment, the runtime derives credentials from the environment. Cloud Run or Compute Engine knows which service account belongs to the workload and can supply short-lived access tokens, commonly with about a one-hour default lifetime, rather than exposing a permanent private key. Expiration does not eliminate token theft, but it sharply limits how long a stolen token remains useful and lets infrastructure handle renewal.

A **metadata server** is the platform mechanism through which supported compute asks for identity information and temporary credentials. The application requests a token; the metadata server knows the attached identity; Google returns short-lived proof for that service account; and the client presents it to Secret Manager, Storage, or another API. Identity comes from the execution environment instead of a file bundled into the container.

## How Do Metadata Servers and ADC Find Short-Lived Credentials?
<!-- section-summary: ADC lets Google client libraries find credentials from the environment without hardcoding a key file in application code. -->

**Application Default Credentials**, or **ADC**, is the lookup strategy Google authentication libraries use to find credentials for your code. The code creates a normal Google Cloud client, and the library finds credentials from the environment around the code.

ADC is not an account, token, service account, or IAM role. It is a discovery algorithm. At a high level, Google authentication libraries first consider the credential configuration named by `GOOGLE_APPLICATION_CREDENTIALS`, then local ADC created for development, then an attached service account available through the metadata server. Because an earlier source wins, a forgotten environment variable can make a test use a different principal from the one you expected.

ADC matters because the same app can run in several places. On Cloud Run, ADC can use the attached service account. On your laptop, ADC can use local developer credentials or local impersonation credentials. In CI/CD, ADC can use a Workload Identity Federation credential configuration. The application code should not need a different authentication branch for each place.

```python
from google.cloud import storage

client = storage.Client()
```

- `storage.Client()` lets the library use ADC instead of a private key passed by application code.
- The same application can discover local credentials on a laptop and the attached service account on Cloud Run.
- IAM still evaluates the resulting principal; credential discovery does not grant permissions.

For local development, a developer can set up ADC with impersonation so local code behaves more like Cloud Run:

```bash
gcloud auth application-default login \
  --impersonate-service-account=checkout-api@acme-prod.iam.gserviceaccount.com
```

- The developer signs in with a human account first.
- IAM checks whether that human may impersonate the target service account.
- The local ADC file requests short-lived credentials for the service account during supported client library calls.

The expected setup message should mention the impersonated service account:

```yaml
Credentials saved to file: [/Users/alice/.config/gcloud/application_default_credentials.json]
These credentials will impersonate service account [checkout-api@acme-prod.iam.gserviceaccount.com].
```

- The file path tells you where ADC stored local configuration.
- The impersonation line confirms that local code will use the workload identity instead of broad personal access.
- Local ADC files still need normal workstation protection because they can request credentials.

The normal `gcloud` CLI login and application ADC are related but distinct configurations. A successful `gcloud storage ls` proves the CLI found credentials for itself; it does not prove the Python application chose the same source. `gcloud auth application-default login` creates the local configuration that ADC-aware applications discover. This distinction is a common explanation for "the CLI works but my code gets 403."

In production on supported Google Cloud compute, the preferred chain is application -> ADC -> metadata server -> attached service account -> short-lived credential -> API. Dedicated service accounts should replace casually reused defaults so checkout, payments, and reporting do not inherit one shared permission set.

## How Does Service Account Impersonation Differ from Attaching an Identity?
<!-- section-summary: Impersonation lets one authenticated principal request short-lived credentials for a service account after IAM approves the handoff. -->

**Service account impersonation** means an already-authenticated principal asks Google Cloud for short-lived credentials for a service account. The source principal might be a human user, a deployer service account, or a federated CI/CD identity. Google Cloud only issues the credentials if IAM allows the handoff.

Impersonation always contains two identities. Alice first authenticates as `alice@example.com`. IAM then checks whether she may request credentials for `checkout-api`. The issued token represents the service account, so resource calls use `checkout-api` permissions rather than Alice's ordinary Storage roles. Audit evidence can preserve the delegation chain: which source principal requested credentials and which service account ultimately called the resource.

Impersonation is useful for two common paths. A developer can debug local code with the same identity that Cloud Run uses. A build pipeline can deploy as `deploy-bot@...` without storing a JSON private key in the CI system.

The smallest local-debug grant lives on the target service account resource:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  checkout-api@acme-prod.iam.gserviceaccount.com \
  --project=acme-prod \
  --member="user:alice@example.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

- `user:alice@example.com` is the **source principal**. Alice is already authenticated to Google Cloud.
- `checkout-api@acme-prod.iam.gserviceaccount.com` is the **target service account**. IAM checks whether Alice can mint short-lived credentials for that service account.
- `roles/iam.serviceAccountTokenCreator` allows short-lived token creation and use of the `--impersonate-service-account` flag. It should be granted on the service account that needs impersonation, not casually across every service account in the project.

The policy output should show Alice only on the service account that matches the debug task:

```yaml
bindings:
- members:
  - user:alice@example.com
  role: roles/iam.serviceAccountTokenCreator
etag: BwYh5DbtF4I=
```

If a CI service account needs the same handoff, the source principal changes to `serviceAccount:deploy-bot@ci-prod.iam.gserviceaccount.com`. The target service account stays `checkout-api@...` only if the pipeline truly needs to test or deploy as the runtime identity.

For a one-command check, a developer can upload a tiny probe object as the runtime service account. This matches an object-creator grant because it proves `storage.objects.create` instead of requiring object listing permission:

```bash
printf 'impersonation probe\n' > /tmp/checkout-api-probe.txt

gcloud storage cp /tmp/checkout-api-probe.txt \
  gs://orders-prod/impersonation-probes/alice-20260704.txt \
  --impersonate-service-account=checkout-api@acme-prod.iam.gserviceaccount.com
```

- The human running the command must have permission to impersonate `checkout-api@...`.
- The storage request is authorized as the service account, so bucket IAM still controls the result.
- The probe writes one known object path; it does not prove list or read access.
- Audit logs can show service account delegation details for supported flows.

Expected output should show one completed upload:

```console
Copying file:///tmp/checkout-api-probe.txt to gs://orders-prod/impersonation-probes/alice-20260704.txt
  Completed files 1/1 | 22B/22B
```

- Success means the impersonation path and object-create permission both worked.
- A failure can come from missing impersonation permission or missing bucket access, so check both sides.
- The command should not require a downloaded service account key.

Two roles appear often. `roles/iam.serviceAccountUser` lets a principal attach a service account to a runtime such as Cloud Run or Compute Engine. `roles/iam.serviceAccountTokenCreator` lets a principal mint short-lived tokens for a service account through the IAM Credentials API. Use the role that matches the handoff you need rather than granting both by habit.

This is the difference between `actAs` and token creation. A deployer uses `iam.serviceAccounts.actAs` to configure Cloud Run to execute as `checkout-api`; the future workload obtains credentials inside its runtime. An impersonating caller uses token-creation permissions to receive short-lived credentials immediately. Both control a service account resource, but they enable different actions and should not be granted together without a reason.

Impersonation is safer than downloading a key because the source principal must first authenticate, IAM must approve the handoff, the resulting credential expires, and logs can connect the two identities. Possession of a service-account private key, by contrast, can be sufficient to authenticate as that account without a fresh Google identity check.

## Why Should Service Account Keys Be an Exception?
<!-- section-summary: Service account keys are long-lived private credentials, so keyless runtime identity and impersonation are safer defaults. -->

A **service account key** is a long-lived private credential for a service account. Older systems often used a downloaded JSON key file so code outside Google Cloud could authenticate as a service account. That pattern is risky because anyone who gets the file can use it until the key is disabled, deleted, or expires through organization policy controls.

Modern Google Cloud designs prefer keyless paths. Workloads inside Google Cloud use attached runtime identities. Developers and automation use impersonation. External CI/CD systems use Workload Identity Federation. Those paths create short-lived credentials and give audit logs a better story about the source identity.

Keys still show up during migrations. A legacy appliance may only understand JSON key files, or a third-party integration may have no federation support yet. Treat those cases as exceptions with a named owner, a rotation plan, a storage location, and monitoring for key use.

The danger is copyability. One JSON private key can be committed to Git, emailed, placed on a laptop, embedded in a container, stored in a backup, and left in a CI variable. A user-managed key does not expire by default unless an organization adds expiry controls, so each forgotten copy can remain an authentication capability until the key is disabled or deleted. Key rotation then has to find consumers that the platform may no longer know about.

Use a location-driven decision. Google Cloud workloads should normally use an attached identity. GKE pods should use Workload Identity Federation for GKE. Workloads on AWS, Azure, GitHub, GitLab, or another supported identity provider should exchange their native identity through federation. Impersonation covers controlled handoffs after a principal authenticates. A service-account key remains the escape hatch for a legacy environment with no viable native or federated path.

If you must inspect existing keys for one service account, use a read-only command first:

```bash
gcloud iam service-accounts keys list \
  --iam-account=legacy-integration@acme-prod.iam.gserviceaccount.com \
  --project=acme-prod
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

## How Does Workload Identity Federation Remove Cross-Environment Keys?
<!-- section-summary: Workload Identity Federation lets external workloads exchange trusted external identity for short-lived Google Cloud credentials. -->

**Workload Identity Federation** lets a workload outside Google Cloud use a trusted external identity to get short-lived Google Cloud credentials. The external workload might run in GitHub Actions, GitLab CI, another cloud provider, or an on-premises platform. The key idea is that Google Cloud trusts a token from that external system and maps it to a Google Cloud identity path.

Federation means Google trusts another configured identity authority under explicit rules. A **workload identity pool** gives the external identity domain a Google Cloud namespace; separate production, staging, and development environments can use separate pools. A **provider** says who issues the evidence, how to validate it, how external claims map to `google.subject` and other attributes, and which issuers, accounts, repositories, or workloads are acceptable.

At runtime, the external workload obtains proof from AWS, Azure, OIDC, SAML, or another supported source. Google's Security Token Service validates that proof and performs an OAuth token exchange for a short-lived federated Google credential. The application proves an identity it already has rather than storing a permanent Google private key beside it.

For the checkout application, the build pipeline can deploy Cloud Run without a service account key. GitHub Actions receives an OIDC token for one approved repository and branch. Google Cloud validates that token through a workload identity pool and provider. The workflow then impersonates `deploy-bot@acme-prod.iam.gserviceaccount.com` for the deployment.

![Keyless CI/CD federation](/content-assets/articles/article-cloud-providers-gcp-identity-security-service-accounts-apps-automation/keyless-cicd-federation.png)
*A keyless CI/CD path exchanges the CI provider's identity token for short-lived Google credentials, then deploys through a narrow service account.*

A practical GitHub Actions setup has three pieces: a pool, an OIDC provider, and a binding on the deploy service account. The pool groups external identities. The provider tells Google Cloud how to trust GitHub's token. The service-account binding names which repository identity can impersonate `deploy-bot`.

Federation does not always require a service account. Where the Google service supports the pattern, the federated principal can receive a role directly on a resource, such as BigQuery Data Viewer on one dataset. A second pattern lets the federated principal impersonate a service account for compatibility or for software that expects a service-account identity. Direct access is simpler when supported; impersonation adds a deliberate identity handoff.

```bash
PROJECT_NUMBER="$(gcloud projects describe acme-prod --format='value(projectNumber)')"

gcloud iam workload-identity-pools create github-deploy \
  --project=acme-prod \
  --location=global \
  --display-name="GitHub deploy"

gcloud iam workload-identity-pools providers create-oidc github-actions \
  --project=acme-prod \
  --location=global \
  --workload-identity-pool=github-deploy \
  --issuer-uri="https://token.actions.githubusercontent.com/" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition='assertion.repository=="acme/checkout-app" && assertion.ref=="refs/heads/main"'

gcloud iam service-accounts add-iam-policy-binding \
  deploy-bot@acme-prod.iam.gserviceaccount.com \
  --project=acme-prod \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-deploy/attribute.repository/acme/checkout-app"
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
      service_account: deploy-bot@acme-prod.iam.gserviceaccount.com
```

Healthy evidence should be simple: the workflow log shows that the auth step created Google credentials, the Cloud Run deployment audit log names `deploy-bot@acme-prod.iam.gserviceaccount.com`, and Service Account Credentials or Security Token Service audit logs show the external principal path from the workload identity pool.

The production review should ask a few practical questions:

| Question | Why it matters |
|---|---|
| Which external identity provider is trusted? | A pool should trust the CI provider your team actually uses. |
| Which repository, branch, or workflow can use the path? | Conditions prevent every workflow in an organization from deploying production. |
| Which service account can be impersonated? | The deploy identity should have deployment access, not runtime data access. |
| How long do the credentials last? | Short-lived credentials reduce the damage from token exposure. |

GKE has a related path called Workload Identity Federation for GKE. A Kubernetes ServiceAccount can map to IAM access, so a pod calls Google Cloud APIs without using the node's service account and without mounting a JSON key. That keeps pod identity closer to the application that needs access.

A Kubernetes ServiceAccount and a Google IAM service account share a name but are different identities. The Kubernetes account is namespace-scoped and belongs to pods. With Workload Identity Federation for GKE, a pod presents a Kubernetes ServiceAccount token to the GKE metadata server, Security Token Service exchanges it for a short-lived federated Google token, and IAM evaluates the workload principal. Supported resources can grant that principal access directly, or the GKE identity can impersonate an IAM service account when compatibility requires it.

This solves the node-identity problem. If frontend, payment, and reporting pods all inherit the node VM's account, compromise of one workload can expose permissions intended for another. Pod-level Kubernetes identities and federation let each workload carry its own security boundary while the underlying node remains shared infrastructure.

External-cloud federation follows the same logic. An AWS analytics worker already has an AWS IAM role and temporary AWS credentials. A provider can validate the AWS account and role, map them into a federated Google principal, and let Security Token Service exchange that proof. Copying a Google JSON key into EC2 would create a second long-lived secret even though the workload already possesses a strong native identity.

When federation fails, trace the chain rather than guessing at the final role. Check the external issuer and audience, the token claims, provider validation, attribute mapping, provider conditions, the resulting subject or principal set, the direct resource grant, and—if present—the service-account impersonation grant. A correct BigQuery role on `deploy-bot` cannot repair an OIDC token rejected before Google recognizes any principal.

![GKE workload identity choices](/content-assets/articles/article-cloud-providers-gcp-identity-security-service-accounts-apps-automation/gke-workload-identity-choices.png)
*GKE workload identity keeps pod-level access separate from the node identity and from downloaded key files.*

## How Should AWS Readers Translate These Identity Concepts?
<!-- section-summary: GCP service accounts cover the workload-identity job that AWS IAM roles often cover, with different attachment and impersonation mechanics. -->

AWS readers can map a GCP service account to the workload identity job often handled by an AWS IAM role attached to EC2, Lambda, ECS, or EKS. In both clouds, software should receive short-lived, scoped credentials instead of a copied long-lived secret.

The handoff mechanics differ. In AWS, workloads often receive credentials through STS role assumption. In Google Cloud, code inside managed runtimes usually uses an attached service account through ADC. A human, CI job, or external workload can also impersonate a service account after IAM allows it.

Workload Identity Federation is the closest GCP idea to using external OIDC and STS-style token exchange for keyless CI/CD. The goal is the same: trust the external workload identity, issue short-lived cloud credentials, and avoid storing static cloud keys in the pipeline.

The most important vocabulary reset is the word **role**. An AWS IAM role is an assumable identity that can produce temporary credentials. A GCP IAM role is only a permission bundle. The closer GCP analogue to an AWS workload role is a service account or federated workload principal. Attaching a role to EC2 and receiving credentials through IMDS follows the same deep pattern as attaching a service account to Compute Engine or Cloud Run and receiving credentials through the metadata server.

AWS `sts:AssumeRole` and GCP service-account impersonation are useful conceptual analogues: identity A authenticates, policy permits the handoff, and temporary credentials represent identity B. The provider nouns and policy surfaces differ, so translate the identity, credential, permission, attachment, and token-exchange jobs rather than equating product objects one for one.

## How Do You Debug the Caller and Choose the Safest Credential Path?
<!-- section-summary: Service account failures usually come from the wrong runtime identity, missing resource access, or missing impersonation permission. -->

For a workload with `403 PERMISSION_DENIED`, first confirm the caller. In Cloud Run, check the service account attached to the service revision. In Compute Engine, check the VM's attached service account and OAuth scopes. In GKE, check the Kubernetes ServiceAccount and the workload identity mapping.

Then identify the credential source ADC actually chose. On a laptop it might be local ADC or a file named by `GOOGLE_APPLICATION_CREDENTIALS`. On Cloud Run it should usually be the attached service account through metadata. In GKE it can be a federated Kubernetes principal. On AWS or GitHub it begins with external evidence, provider validation, claim mapping, and token exchange. Only after the resulting principal is known does checking resource IAM become meaningful.

For Cloud Run, export the current service YAML or query the service account field directly:

```bash
gcloud run services describe checkout-api \
  --project=acme-prod \
  --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)'
```

```console
checkout-api@acme-prod.iam.gserviceaccount.com
```

- This is the runtime identity the container uses for Google Cloud API calls.
- If the output shows the default Compute Engine service account, the bucket policy may be correct while the service is running as the wrong caller.
- A new service account setting creates a new Cloud Run revision, so compare the active traffic revision with the revision that has the expected identity.

Next, check whether the service account has the resource role it needs. The checkout API may run as the right service account and still fail if bucket IAM grants access to `checkout-api-staging@...` or to the deploy bot instead of the runtime account.

Check the target service account's own IAM policy for problems involving attachment or impersonation:

```bash
gcloud iam service-accounts get-iam-policy \
  checkout-api@acme-prod.iam.gserviceaccount.com \
  --project=acme-prod \
  --format=yaml
```

```yaml
bindings:
- members:
  - user:alice@example.com
  role: roles/iam.serviceAccountTokenCreator
- members:
  - serviceAccount:deploy-bot@ci-prod.iam.gserviceaccount.com
  role: roles/iam.serviceAccountUser
```

- `roles/iam.serviceAccountTokenCreator` answers who can mint short-lived credentials for local tests or CLI impersonation.
- `roles/iam.serviceAccountUser` answers who can attach the service account to a runtime during deployment.
- These bindings live on the service account resource. They do not grant bucket access by themselves.

Finally, check the handoff permission. A deployer can fail before the app starts if it lacks permission to attach the runtime service account. A developer can fail local impersonation if they lack token-creation permission on the target service account. These errors look similar from far away, so keep the two views separate: service account as principal, and service account as resource.

Impersonation has two authorization steps: can the source principal mint credentials for the target service account, and can that service account access the final resource? Federation adds issuer, audience, provider condition, attribute mapping, federated-principal grant, and optional impersonation checks. Follow each identity transformation in order rather than broadening roles at the end of the chain.

Keep the evidence for those stages separate. An impersonation failure before a token is created points to the source principal's permission on the service account resource. A later API denial points to the impersonated service account's permission on the destination resource. For many services, Cloud Audit Logs can show both the impersonated service account and the identity that requested its short-lived credential. Federation requires the same stepwise reading: validate the external issuer and audience first, then the provider condition and attribute mapping, then the Google principal binding, and only then the final resource permission. A single `403` at the application boundary can therefore represent several different failed handoffs.

The expected identity can be wrong in several ordinary ways. Local ADC may still represent Alice. `GOOGLE_APPLICATION_CREDENTIALS` may point to a stale configuration file. Cloud Run may use a default service account. A GKE pod may fall back to the node identity. An external provider may map a repository, branch, account, or role into a different principal set. Write down where the code runs, which source produced credentials, and which principal appeared in the failed request before changing IAM.

The distinction "identity is not the secret" is the reason these mechanisms compose. `checkout-api` can remain the same identity for years while token A, B, C, and D each expire. Federation and impersonation change how temporary proof is acquired, while IAM continues to evaluate the stable resulting principal. The application does not need to know the cryptographic details of every environment; ADC and the runtime or exchange system own that acquisition path.

An impersonation test should prove both sides of the path. First, confirm the signed-in source principal:

```bash
gcloud auth list \
  --filter='status:ACTIVE' \
  --format='value(account)'
```

```console
alice@example.com
```

Then call a harmless create-object probe through the target service account:

```bash
printf 'caller identity probe\n' > /tmp/checkout-api-debug.txt

gcloud storage cp /tmp/checkout-api-debug.txt \
  gs://orders-prod/debug-probes/alice-20260704.txt \
  --impersonate-service-account=checkout-api@acme-prod.iam.gserviceaccount.com
```

```console
Copying file:///tmp/checkout-api-debug.txt to gs://orders-prod/debug-probes/alice-20260704.txt
  Completed files 1/1 | 22B/22B
```

- If impersonation fails before the storage call, fix the target service account policy.
- If impersonation succeeds and storage fails, fix the resource policy on the bucket or project.
- If the probe succeeds but a list command still fails, the bucket probably grants create without list, which can be a valid least-privilege design.
- If both the probe and policy checks succeed locally while Cloud Run still fails, the deployed revision is likely using a different runtime identity or a different bucket name.

A production system can apply the same pattern everywhere. Cloud Run attaches `checkout-api`; GKE payment pods use their Kubernetes ServiceAccount through federation; GitHub Actions exchanges OIDC evidence for a narrow deployment principal; an AWS analytics worker federates its AWS role directly to BigQuery access. None needs a Google private key stored with application code.

Keep the credential hierarchy in mind. Prefer native attached workload identity, then federation for an external or Kubernetes identity, then controlled service-account impersonation, and treat user-managed service-account keys as the exceptional long-lived path. The unifying chain is stable software identity -> ephemeral credential -> IAM decision -> target resource.

That chain also keeps audit evidence readable: the runtime identity, any delegating or federated source, the requested permission, and the target resource can be reviewed without exposing a private key.

The service account can stay stable while credentials turn over continuously. That is the central improvement over treating one copied credential as the identity itself: software keeps a durable name, the environment keeps issuing expiring proof, and IAM can change permissions without rebuilding the application artifact.

## Check Your Answers

:::expand[Why Does Software Need Its Own Identity?]{kind="recap"}
Separate service accounts let each workload receive only its own permissions, while identity stays independent from the human who deployed it and from each temporary credential.
:::

:::expand[How Is a Service Account Both a Principal and a Resource?]{kind="recap"}
As a principal, the service account receives roles on other resources. As a resource, it controls who may attach, impersonate, manage, or create credentials for it.
:::

:::expand[How Do Metadata Servers and ADC Find Short-Lived Credentials?]{kind="recap"}
ADC discovers a credential source; on supported compute, the metadata server supplies short-lived proof for the attached service account without a key in application code.
:::

:::expand[How Does Service Account Impersonation Differ from Attaching an Identity?]{kind="recap"}
`actAs` lets a deployer configure a workload to run as the service account. Token creation lets an authenticated principal obtain short-lived credentials representing it now.
:::

:::expand[Why Should Service Account Keys Be an Exception?]{kind="recap"}
A copied private key can authenticate as the service account for a long time and is hard to inventory and rotate. Native identity, federation, or impersonation usually removes it.
:::

:::expand[How Does Workload Identity Federation Remove Cross-Environment Keys?]{kind="recap"}
Google validates an external workload's existing identity through a pool and provider, exchanges the proof for a short-lived token, and grants the federated principal direct or impersonated access.
:::

:::expand[How Should AWS Readers Translate These Identity Concepts?]{kind="recap"}
An AWS workload role maps more closely to a GCP service account or workload principal; a GCP IAM role is a permission bundle, and impersonation resembles an AssumeRole handoff.
:::

:::expand[How Do You Debug the Caller and Choose the Safest Credential Path?]{kind="recap"}
Trace runtime, ADC source, resulting principal, optional identity handoffs, and final resource permission. Prefer attached identity, federation, or impersonation before a stored key.
:::

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
