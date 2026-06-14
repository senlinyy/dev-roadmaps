---
title: "Service Accounts and Workload Identity"
description: "Use service accounts, ADC, impersonation, and Workload Identity Federation so GCP workloads and CI/CD pipelines call cloud APIs without JSON keys."
overview: "Service accounts answer a practical production question: which software identity is calling this Google Cloud API? This article follows devpolaris-orders-api as it runs inside GCP, deploys from CI/CD, avoids JSON keys, and debugs access failures."
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

1. [The Access Question for Software](#the-access-question-for-software)
2. [Service Accounts as Principals and Resources](#service-accounts-as-principals-and-resources)
3. [Runtime Identity Inside Google Cloud](#runtime-identity-inside-google-cloud)
4. [Application Default Credentials](#application-default-credentials)
5. [Service Account Impersonation](#service-account-impersonation)
6. [Service Account Keys and the Legacy Migration Problem](#service-account-keys-and-the-legacy-migration-problem)
7. [Workload Identity Federation for CI/CD and External Workloads](#workload-identity-federation-for-cicd-and-external-workloads)
8. [Workload Identity Federation for GKE](#workload-identity-federation-for-gke)
9. [Debugging Service Account Access Failures](#debugging-service-account-access-failures)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Access Question for Software
<!-- section-summary: Software needs its own caller identity, so GCP service accounts give applications and automation an auditable principal. -->

GCP IAM checks every request by asking a few plain questions: **who is calling**, **what action are they trying to take**, **which resource are they touching**, and **which policies apply to that request**. For a human, the caller might be `alice@devpolaris.com` after she signs in through the company identity provider. For software, the caller should be a dedicated service account, because production code should have its own identity instead of borrowing a person's session.

A **service account** is a Google Cloud account for software, automation, and compute workloads. It has an email-like name such as `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`, and Google Cloud treats that email as a principal in IAM policies. When the Orders API reads a Secret Manager secret, writes a Pub/Sub message, or calls another Cloud Run service, the request should show this service account as the caller in Cloud Audit Logs.

This article follows one practical setup. The application is `devpolaris-orders-api`, the production project is `devpolaris-prod`, the runtime identity is `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`, and the deployment identity is `deployer-ci@devpolaris-prod.iam.gserviceaccount.com`. The runtime identity runs the app inside Google Cloud. The deployment identity lets CI/CD release the app from outside Google Cloud without storing a downloaded JSON private key.

The important split is simple: **runtime identity** handles what the app can do after it starts, and **deploy identity** handles what the release system can change while shipping the app. Mixing those two creates messy permissions, noisy logs, and risky escalation paths. Keeping them separate makes the access story easier to inspect during normal operations and during incidents.

## Service Accounts as Principals and Resources
<!-- section-summary: A service account can call APIs as a principal, and it also has its own IAM policy that controls who can attach or impersonate it. -->

In Google Cloud, a service account has two jobs at the same time. As a **principal**, it can receive roles on projects, buckets, secrets, topics, databases, and other resources. As a **resource**, it has its own IAM policy that controls who can use it, attach it to runtimes, impersonate it, administer it, or create keys for it.

That dual role is the part that trips people up. If `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com` needs to read the `orders-db-password` secret, you grant the service account the Secret Manager Secret Accessor role on that secret. If `deployer-ci@devpolaris-prod.iam.gserviceaccount.com` needs to deploy Cloud Run revisions that run as `orders-api-runtime@...`, you grant the deployer permission on the service account resource itself.

| Service account view | The question you are answering | Example |
|---|---|---|
| **Principal** | What can this software identity access? | Grant `orders-api-runtime@...` `roles/secretmanager.secretAccessor` on one secret. |
| **Resource** | Who can use or manage this service account? | Grant `deployer-ci@...` `roles/iam.serviceAccountUser` on `orders-api-runtime@...` so the deployer can attach it to Cloud Run. |

Here is the resource-access side for the Orders API secret. The member is the runtime service account, and the role belongs on the secret because the app only needs that one secret:

```bash
gcloud secrets add-iam-policy-binding orders-db-password \
  --project=devpolaris-prod \
  --member="serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Here is the service-account-resource side for Cloud Run deployment. The deployer receives permission on the runtime service account, because attaching a service account to a Cloud Run revision requires permission to act as that service account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com \
  --project=devpolaris-prod \
  --member="serviceAccount:deployer-ci@devpolaris-prod.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Those two bindings solve different problems. The first binding lets the running Orders API read a secret. The second binding lets the deployment identity attach the runtime identity to a Cloud Run service. If the second binding gets granted too broadly, a person or pipeline can attach a powerful service account to compute they control and then run code with that service account's access.

Service accounts deserve the same lifecycle care as the workload they belong to. A single account named `backend@devpolaris-prod.iam.gserviceaccount.com` shared by ten services gives every service the combined access of all ten, and Cloud Audit Logs only show the shared service account. A dedicated name like `orders-api-runtime@...` lets the team read logs and know which application made the request.

## Runtime Identity Inside Google Cloud
<!-- section-summary: Managed GCP runtimes attach a service account to the compute resource, and application code receives short-lived credentials from the environment. -->

Inside Google Cloud, the normal pattern is **attached runtime identity**. You create a user-managed service account, grant it only the roles the workload needs, and attach it to the resource that runs the code. Google Cloud then gives the code short-lived credentials through the runtime environment, so the container, VM, function, or pod avoids storing a private key file.

For `devpolaris-orders-api`, the runtime identity should be `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`. That account might read one database password in Secret Manager, publish order events to one Pub/Sub topic, and write logs. Deployment, IAM administration, service account key creation, and project administration belong to different identities.

Cloud Run makes the split very visible. The **deployer identity** creates or updates the Cloud Run service. The **service identity** runs inside each instance of the service and calls Google Cloud APIs from application code. A production deployment usually sets the service identity explicitly:

```bash
gcloud run deploy devpolaris-orders-api \
  --project=devpolaris-prod \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/devpolaris-prod/orders/devpolaris-orders-api:2026-06-14 \
  --service-account=orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com
```

Cloud Run services with no explicit service account fall back to a default Compute Engine service account. That default account often carries more access than one application needs, especially in older projects where automatic Editor grants still exist. A named runtime identity gives the Orders API a smaller permission boundary and clearer logs.

Compute Engine uses the same idea with VMs. A VM can have one attached service account at a time, and applications on the VM can use that attached account to call Google Cloud APIs. Compute Engine also has **access scopes**, which can further limit OAuth-based API access, so the usual modern setup grants the VM the `cloud-platform` scope and controls real access with IAM roles on the service account.

```bash
gcloud compute instances create orders-worker-1 \
  --project=devpolaris-prod \
  --zone=us-central1-a \
  --service-account=orders-worker-runtime@devpolaris-prod.iam.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/cloud-platform
```

Cloud Functions also has a runtime service account. For current Cloud Run functions, each function can run as a named service account, and the deploy command can set it with `--service-account`. Event handlers usually need narrower access than a full API backend, so a function that only processes order events can use `orders-events-runtime@...` instead of sharing the Orders API account.

```bash
gcloud functions deploy orders-on-payment-settled \
  --project=devpolaris-prod \
  --region=us-central1 \
  --gen2 \
  --runtime=nodejs22 \
  --trigger-topic=payment-settled \
  --service-account=orders-events-runtime@devpolaris-prod.iam.gserviceaccount.com
```

GKE has one extra layer because Kubernetes also has service accounts. A Pod runs as a **Kubernetes ServiceAccount**, and Google Cloud IAM can recognize that Kubernetes identity through Workload Identity Federation for GKE. That lets Pods call Google Cloud APIs without node-level keys and without every Pod sharing the node's service account.

The pattern across all four runtimes is consistent. Cloud Run, Compute Engine, Cloud Functions, and GKE all need a clear answer to "which software identity is this code using?" If the answer is a named per-application identity, access reviews and incident response have a real starting point.

## Application Default Credentials
<!-- section-summary: ADC lets client libraries find the right local, federated, or attached runtime credentials without changing application code. -->

**Application Default Credentials**, usually shortened to **ADC**, is the lookup strategy Google authentication libraries use to find credentials for application code. The Orders API should create normal Google Cloud clients, such as a Secret Manager client or Pub/Sub client, and let ADC find credentials from the surrounding environment. The same source code can run on a laptop, in Cloud Run, in GKE, or inside CI/CD while authentication stays outside the business logic.

ADC checks locations in a documented order. It first checks the `GOOGLE_APPLICATION_CREDENTIALS` environment variable, then a local ADC file created by `gcloud auth application-default login`, and then the attached service account from the metadata server on supported Google Cloud runtimes. That order matters during debugging because a stray environment variable can override the runtime identity you thought the app was using.

The `GOOGLE_APPLICATION_CREDENTIALS` variable points to a credential file, and the file type matters. It can point to a Workload Identity Federation credential configuration, which is a keyless setup. It can also point to a service account key JSON file, which carries a long-lived private key and should be treated as a legacy exception.

In local development, a developer can use ADC with their user account for low-risk development resources. For production-like local testing, impersonation gives the app a better match to Cloud Run because the local ADC file can request short-lived tokens for the runtime service account. The developer still signs in as a human first, and Google Cloud checks whether that human has permission to impersonate the service account.

```bash
gcloud auth application-default login \
  --impersonate-service-account=orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com
```

After that setup, application code stays simple. A Node.js service can create a client without loading a JSON key path, because ADC handles the authentication lookup:

```js
import {SecretManagerServiceClient} from "@google-cloud/secret-manager";

const secrets = new SecretManagerServiceClient();

const [version] = await secrets.accessSecretVersion({
  name: "projects/devpolaris-prod/secrets/orders-db-password/versions/latest",
});

const databasePassword = version.payload?.data?.toString("utf8");
```

The same code works in Cloud Run because ADC reaches the metadata server and receives credentials for `orders-api-runtime@...`. It works in a properly configured CI job because ADC can read a Workload Identity Federation credential configuration and exchange the CI provider's token for Google credentials. This keeps authentication outside the application code, where security teams and platform teams can manage it.

## Service Account Impersonation
<!-- section-summary: Impersonation lets an already-authenticated principal request short-lived credentials for a service account after IAM approves that handoff. -->

**Service account impersonation** means one authenticated principal asks Google Cloud for short-lived credentials for a service account. The starting principal might be a human user, another service account, or a federated CI/CD identity. Google Cloud only issues the short-lived credentials if IAM allows that principal to impersonate the target service account.

This is useful because the caller needs to authenticate first. If Priya signs in with her user account and impersonates `orders-api-runtime@...` for local debugging, Cloud Audit Logs can show both the user and the service account involved in many requests. If GitHub Actions federates into Google Cloud and impersonates `deployer-ci@...`, the CI job uses short-lived credentials tied to one workflow run instead of a static secret copied into repository settings.

Two roles show up often, and they solve different access paths:

| Role | Common use | Important permission idea |
|---|---|---|
| `roles/iam.serviceAccountUser` | Lets a deployer attach a service account to a runtime such as Cloud Run or Compute Engine. | This includes the `iam.serviceAccounts.actAs` style of permission. |
| `roles/iam.serviceAccountTokenCreator` | Lets a principal mint short-lived tokens for a service account through the IAM Credentials API. | This includes `iam.serviceAccounts.getAccessToken`. |
| `roles/iam.workloadIdentityUser` | Lets a federated workload identity impersonate a service account through Workload Identity Federation. | This is the usual role for CI/CD and GKE impersonation patterns. |

For day-to-day `gcloud` work, impersonation can happen per command. The following command lists buckets with the service account's access, while the human or source identity still has to satisfy the impersonation permission check first:

```bash
gcloud storage buckets list \
  --project=devpolaris-prod \
  --impersonate-service-account=orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com
```

For release automation, `deployer-ci@devpolaris-prod.iam.gserviceaccount.com` is usually the right impersonation target. The deployer can update Cloud Run, write a new revision, read deployment metadata, and attach `orders-api-runtime@...`. The runtime account keeps the permissions the running application needs, like reading a secret or publishing an event.

Impersonation gives you a clean security review question. Who can impersonate this service account, and what could they do after they receive its credentials? If `deployer-ci@...` can impersonate `orders-api-runtime@...` and deploy Cloud Run, that may be expected. If every engineer can impersonate a production database admin service account, that deserves immediate review.

## Service Account Keys and the Legacy Migration Problem
<!-- section-summary: User-managed service account keys are long-lived private credentials, so modern GCP designs replace them with attached identities, impersonation, or federation. -->

A **service account key** is a downloaded private key for a service account. In the older pattern, a team created a key for `orders-api-runtime@...`, downloaded a JSON file, stored it in a CI secret, mounted it into a container, and set `GOOGLE_APPLICATION_CREDENTIALS` to point at the file. The application could then sign tokens as the service account from any environment that had a copy of the JSON file.

That pattern creates a serious security problem. The private key can authenticate as the service account without another sign-in step, and it keeps working until someone disables or deletes the key. If a key lands in a GitHub repository, a CI log, a Docker image layer, a shared drive, a backup, or a laptop download folder, the exposure can last far longer than the build or runtime that originally needed access.

The replacement path depends on where the workload runs:

| Workload location | Preferred authentication pattern | Why it helps |
|---|---|---|
| Cloud Run, Cloud Functions, Compute Engine | Attach a user-managed service account to the runtime. | The runtime receives short-lived credentials from Google Cloud. |
| GKE | Use Workload Identity Federation for GKE. | Pods receive identity through Kubernetes and IAM instead of node keys. |
| GitHub Actions, GitLab CI, HCP Terraform | Use Workload Identity Federation and usually impersonate a deployer service account. | The external job exchanges its own short-lived OIDC token for Google credentials. |
| Developer workstation | Use user ADC or ADC with service account impersonation. | The developer signs in as a human and receives short-lived credentials. |
| Legacy tool with no federation support | Use a tightly scoped key as a temporary exception. | The exception needs owner approval, key rotation, monitoring, and a migration date. |

For the Orders API, a legacy migration usually starts with inventory. List the keys on the service account, find where each key gets used, and replace each use with a runtime identity or a federated credential configuration. The team should disable a key before deleting it, because disabling gives you a safer test window where the key can be re-enabled if a hidden dependency still exists.

```bash
gcloud iam service-accounts keys list \
  --iam-account=orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com \
  --project=devpolaris-prod
```

After the application runs successfully on attached identity or federation, the old key should leave circulation. A key that remains "just in case" often turns into the credential everyone forgets until a leak or audit finds it. Organization policies can help by blocking new key creation and key upload across production projects, with documented exceptions for the few systems that still need them.

## Workload Identity Federation for CI/CD and External Workloads
<!-- section-summary: Workload Identity Federation lets external systems exchange their own short-lived identity proof for Google credentials instead of storing service account keys. -->

**Workload Identity Federation**, or **WIF**, lets workloads outside Google Cloud authenticate with Google Cloud by using identity proof from their own environment. A GitHub Actions job can use a GitHub OIDC token. A GitLab CI job can use a GitLab ID token. HCP Terraform can use a Terraform OIDC token. An AWS, Azure, on-premises, or self-managed Kubernetes workload can also federate when it has a supported identity provider.

The flow has three pieces. First, the external platform issues a short-lived token that says something specific about the job, repository, branch, workspace, or workload. Next, Google Security Token Service verifies that token against a workload identity pool provider and maps claims into Google IAM attributes. Finally, the job either receives direct access as a federated principal or impersonates a service account such as `deployer-ci@devpolaris-prod.iam.gserviceaccount.com`.

For `devpolaris-orders-api`, CI/CD should impersonate a deployer service account. The deployer service account can deploy Cloud Run and attach the runtime service account, while the runtime service account keeps the application permissions. This avoids putting production Secret Manager access directly into the CI job.

The Google Cloud side usually has these pieces:

| Piece | DevPolaris example | Purpose |
|---|---|---|
| Workload identity pool | `ci-prod` | Groups external CI/CD identities for production. |
| Provider | `github-devpolaris-orders` | Trusts GitHub's OIDC issuer and maps claims. |
| Attribute condition | `assertion.repository_owner == "devpolaris" && assertion.ref == "refs/heads/main"` | Accepts only approved organization and branch claims. |
| Deployer service account | `deployer-ci@devpolaris-prod.iam.gserviceaccount.com` | Receives short-lived impersonated credentials during deployment. |
| Runtime service account | `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com` | Runs the Cloud Run service after deployment. |

GitHub Actions commonly uses the `https://token.actions.githubusercontent.com/` issuer. The provider maps at least `google.subject=assertion.sub`, and production setups often map stable numeric claims such as repository owner ID or repository ID because names can be reused after deletion. Attribute conditions then restrict which organization, repository, branch, environment, or workflow can use the provider.

```bash
gcloud iam workload-identity-pools providers create-oidc github-devpolaris-orders \
  --project=devpolaris-prod \
  --location=global \
  --workload-identity-pool=ci-prod \
  --issuer-uri="https://token.actions.githubusercontent.com/" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner=='devpolaris' && assertion.repository=='devpolaris/devpolaris-orders-api' && assertion.ref=='refs/heads/main'"
```

The service account policy then allows only the matching federated principal set to impersonate `deployer-ci@...`. The project number belongs in the principal identifier, and the role goes on the service account resource:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  deployer-ci@devpolaris-prod.iam.gserviceaccount.com \
  --project=devpolaris-prod \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/ci-prod/attribute.repository/devpolaris/devpolaris-orders-api"
```

The GitHub workflow then asks GitHub for an ID token and lets the Google auth action create a credential configuration file. Tools that understand ADC, including `gcloud`, client libraries, and Terraform, can use that file during the job:

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/123456789012/locations/global/workloadIdentityPools/ci-prod/providers/github-devpolaris-orders
          service_account: deployer-ci@devpolaris-prod.iam.gserviceaccount.com
      - name: Deploy Cloud Run
        run: |
          gcloud run deploy devpolaris-orders-api \
            --project=devpolaris-prod \
            --region=us-central1 \
            --image=us-central1-docker.pkg.dev/devpolaris-prod/orders/devpolaris-orders-api:${{ github.sha }} \
            --service-account=orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com
```

GitLab CI follows the same idea with the `https://gitlab.com` issuer and GitLab ID token claims such as `namespace_id`, `project_id`, `environment`, and `ref_path`. A good production condition uses stable IDs and the deployment environment, for example accepting only jobs from the approved group and the `production` environment. The job writes the ID token to a temporary file, writes a Workload Identity Federation credential configuration, and points `GOOGLE_APPLICATION_CREDENTIALS` at that configuration for the duration of the job.

HCP Terraform also uses OIDC, usually with issuer `https://app.terraform.io`. Terraform workspaces should map stable claims such as `terraform_organization_id` and `terraform_workspace_id`, then restrict the provider to the production workspace. Google Cloud documents one important detail here: HCP Terraform uses service account impersonation rather than direct resource access, so the workspace identity needs `roles/iam.workloadIdentityUser` on the deployer service account.

External workloads outside CI/CD use the same foundation. An AWS workload can exchange AWS credentials through Workload Identity Federation. A self-managed Kubernetes cluster or on-premises system can use OIDC or SAML if it has a trusted identity provider. The design question stays the same: which external identity should Google trust, which claims prove it, and which service account or resource should that identity reach?

## Workload Identity Federation for GKE
<!-- section-summary: GKE uses Kubernetes identities and the GKE metadata server so Pods can access Google Cloud APIs without service account key files. -->

GKE has a special version of the federation pattern called **Workload Identity Federation for GKE**. The cluster gives Pods a Kubernetes identity, and Google Cloud IAM can grant that identity access to Google Cloud resources. This removes the old pattern of mounting a service account JSON key into every Pod that needs to read a secret, write to Cloud Storage, or publish a Pub/Sub message.

The key names matter. A **Kubernetes ServiceAccount** is a Kubernetes object such as `orders/orders-api`. An **IAM service account** is a Google Cloud service account such as `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`. Workload Identity Federation for GKE can let the Kubernetes identity access Google Cloud resources directly, and it can also let the Kubernetes identity impersonate an IAM service account when that fits your compatibility or audit design.

Direct resource access gives IAM roles to the Kubernetes principal identifier. For an Orders API Pod in namespace `orders` using Kubernetes ServiceAccount `orders-api`, the principal identifier follows this shape:

```bash
principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/devpolaris-prod.svc.id.goog/subject/ns/orders/sa/orders-api
```

A secret binding can then target that Kubernetes principal directly:

```bash
gcloud secrets add-iam-policy-binding orders-db-password \
  --project=devpolaris-prod \
  --member="principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/devpolaris-prod.svc.id.goog/subject/ns/orders/sa/orders-api" \
  --role="roles/secretmanager.secretAccessor"
```

The impersonation pattern links the Kubernetes ServiceAccount to an IAM service account. The Kubernetes principal receives `roles/iam.workloadIdentityUser` on `orders-api-runtime@...`, and the Pod receives Google credentials through the GKE metadata server. This pattern helps when a library, tool, or audit convention expects an IAM service account email as the final caller.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com \
  --project=devpolaris-prod \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:devpolaris-prod.svc.id.goog[orders/orders-api]"

kubectl annotate serviceaccount orders-api \
  --namespace=orders \
  iam.gke.io/gcp-service-account=orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com
```

The usual production checklist has four parts. The cluster and node pools use the GKE metadata server. The Pod spec sets `serviceAccountName: orders-api`. IAM grants access to the Kubernetes principal or grants impersonation on the target IAM service account. The application uses ADC, so the code never loads a mounted key file.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api
  namespace: orders
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: orders
spec:
  template:
    spec:
      serviceAccountName: orders-api
      containers:
        - name: api
          image: us-central1-docker.pkg.dev/devpolaris-prod/orders/devpolaris-orders-api:2026-06-14
```

This keeps GKE permissions at the Pod level instead of the node level. If one namespace needs Secret Manager access and another namespace only needs Pub/Sub publishing, their Kubernetes ServiceAccounts can receive different IAM bindings. A compromised Pod then carries the permissions of its own service account rather than the combined permissions of every workload on the node.

## Debugging Service Account Access Failures
<!-- section-summary: Access failures become easier to debug when you separate caller identity, resource role, service-account-resource permissions, runtime attachment, and policy guardrails. -->

The common production error sounds like this: "this service account cannot access that resource." The fix starts by turning that sentence into the same IAM questions every time. Which principal made the call, which permission did the API require, which resource received the request, and which policy allowed or blocked it?

The actual caller comes first. In Cloud Run, describe the service and check the template service account. In Compute Engine, check the VM's attached service account and access scopes. In Cloud Functions, check the runtime service account on the function. In GKE, check the Pod's Kubernetes ServiceAccount and the IAM principal binding or impersonated IAM service account.

```bash
gcloud run services describe devpolaris-orders-api \
  --project=devpolaris-prod \
  --region=us-central1 \
  --format="value(template.serviceAccount)"
```

Cloud Audit Logs usually answer the caller question during a real failure. Filter for the principal email, the denied status, and the target service. A `PERMISSION_DENIED` entry that shows `deployer-ci@...` means the deployment identity made the denied call. A denied entry that shows `orders-api-runtime@...` means the running application made the denied call.

```bash
protoPayload.authenticationInfo.principalEmail="orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com"
protoPayload.status.code=7
```

The missing permission comes next, because role names can hide the exact failing API check. Secret Manager secret access uses a permission such as `secretmanager.versions.access`. Cloud Storage object reads use storage object permissions. Cloud Run deployment needs Cloud Run permissions, and attaching a service account also needs permission on the service account resource. Error messages often name the exact missing permission, and that name tells you which role or custom role to inspect.

The resource boundary comes after the permission. A role on the project may apply broadly, but many production systems grant roles on individual secrets, buckets, topics, queues, or services. If `orders-api-runtime@...` has Secret Accessor on a staging secret, the production secret still rejects the request. If the secret lives in `devpolaris-shared-secrets` and the Cloud Run service lives in `devpolaris-prod`, the binding must exist on the project or resource that owns the secret.

```bash
gcloud secrets get-iam-policy orders-db-password \
  --project=devpolaris-prod \
  --format=json
```

After that, check the service account as a resource. A failed Cloud Run deploy might have nothing to do with Secret Manager. The deployer could be missing `roles/iam.serviceAccountUser` on `orders-api-runtime@...`, so it cannot attach that identity to the revision. A failed WIF job could be missing `roles/iam.workloadIdentityUser` on `deployer-ci@...`, so the external principal cannot impersonate the deployer service account.

Policy guardrails can also deny a request that looks allowed. IAM deny policies, principal access boundary policies, organization policies, VPC Service Controls, disabled APIs, cross-project service account usage restrictions, and service agents can all affect real deployments. Policy Troubleshooter helps because it evaluates a principal, a resource, and a permission together instead of asking you to inspect every policy by hand.

A practical debug order for the Orders API looks like this:

1. Confirm the runtime is actually using `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`.
2. Find the denied API call in Cloud Audit Logs and copy the missing permission.
3. Check IAM on the exact resource, such as the Secret Manager secret or Pub/Sub topic.
4. Check IAM on the service account resource if the action involves attachment, impersonation, or key creation.
5. Check federation attributes if the caller comes from GitHub Actions, GitLab CI, HCP Terraform, or another external provider.
6. Check deny policies, organization policies, VPC Service Controls, API enablement, and required service agents if the allow binding looks correct.

This order keeps the team from guessing. If the caller is wrong, fix the attachment or ADC setup. If the caller is right and the resource role is missing, add the narrow binding. If the role exists and a guardrail denies the call, adjust the guardrail only after the security owner confirms the access path should exist.

## Putting It All Together
<!-- section-summary: The production pattern uses attached runtime identity inside GCP, federated deploy identity outside GCP, and no long-lived JSON keys. -->

The finished `devpolaris-orders-api` setup has two service accounts with separate responsibilities. `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com` runs the application and receives only application permissions. `deployer-ci@devpolaris-prod.iam.gserviceaccount.com` deploys the application and receives only release permissions plus permission to attach the runtime account.

Inside Google Cloud, the Orders API uses attached runtime identity. Cloud Run revisions run as `orders-api-runtime@...`, client libraries use ADC, and the runtime receives short-lived credentials from the metadata server. The application reads its database secret, publishes order events, and writes logs without any JSON key in the container image or environment.

Outside Google Cloud, CI/CD uses Workload Identity Federation. GitHub Actions, GitLab CI, HCP Terraform, or another external workload presents its own short-lived identity proof to Google Security Token Service. Google Cloud accepts the token only if the provider, mappings, and attribute conditions match the approved organization, repository, branch, environment, or workspace.

The CI/CD job then impersonates `deployer-ci@...`. That deployer can update Cloud Run and attach `orders-api-runtime@...`, while Secret Manager access stays with the runtime account. If the CI workflow gets compromised, the attacker receives a short-lived deployment credential with a narrower job than the running application identity.

The legacy JSON key story turns into a migration checklist instead of a default design. Existing keys get inventoried, disabled, monitored, and deleted after the workload moves to attached identity, impersonation, or federation. New key creation stays blocked in production unless a documented exception proves that a workload cannot use the safer patterns.

That is the access shape you want people on the team to recognize. Software gets named service accounts. Runtimes receive attached identities. External automation federates and impersonates. Debugging follows the caller, permission, resource, and guardrail path until the exact missing access is visible.

## What's Next

Service accounts answer who the Orders API is when it calls Google Cloud. The next problem is where the application stores sensitive values such as database passwords, API tokens, and signing secrets, and how the runtime identity receives only the secrets it needs.

The next article covers Secret Manager. It explains secrets, versions, IAM access, rotation patterns, customer-managed encryption options, and production guardrails for keeping sensitive configuration out of source code and container images.

---

**References**

- [Google Cloud: Service accounts overview](https://docs.cloud.google.com/iam/docs/service-account-overview) - Explains service accounts as workload identities, service accounts as resources, attached service accounts, credentials, impersonation, and key risk.
- [Google Cloud: Best practices for using service accounts securely](https://docs.cloud.google.com/iam/docs/best-practices-service-accounts) - Covers dedicated service accounts, service account lifecycle, impersonation risk, default accounts, and service-account-resource permissions.
- [Google Cloud: Best practices for managing service account keys](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys) - Documents service account key risks and safer authentication alternatives.
- [Google Cloud: Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation) - Describes workload identity pools, providers, direct access, service account impersonation, and external workload token exchange.
- [Google Cloud: Service account impersonation](https://docs.cloud.google.com/iam/docs/service-account-impersonation) - Explains short-lived service account credentials, gcloud impersonation, ADC impersonation, and audit log behavior.
- [Google Cloud: Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials) - Documents ADC search order and supported credential sources.
- [Google Cloud: Use service account impersonation](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation) - Shows gcloud and local ADC setup for impersonating service accounts.
- [Google Cloud: Configure Workload Identity Federation with deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) - Provides GitHub Actions, GitLab SaaS, HCP Terraform, and other deployment pipeline federation setup details.
- [Google Cloud: Best practices for using service accounts in pipelines](https://docs.cloud.google.com/iam/docs/best-practices-for-using-service-accounts-in-deployment-pipelines) - Explains how deployment pipelines differ from interactive access and why WIF helps avoid key-based deployments.
- [Google Cloud: Best practices for using Workload Identity Federation](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation) - Covers attribute conditions, dedicated pools, stable attributes, and limiting impersonation access.
- [Google Cloud: Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity) - Explains Cloud Run service identities, ADC, metadata server token flow, and user-managed service account recommendations.
- [Google Cloud: Compute Engine service accounts](https://docs.cloud.google.com/compute/docs/access/service-accounts) - Documents attached VM service accounts, access scopes, and default Compute Engine service account behavior.
- [Google Cloud: Cloud Run functions function identity](https://docs.cloud.google.com/functions/docs/securing/function-identity) - Shows how to set or update a function runtime service account.
- [Google Cloud: Workload Identity Federation for GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/workload-identity) - Explains GKE workload identity pools, Kubernetes ServiceAccount principals, and the GKE metadata server.
- [Google Cloud: Authenticate to Google Cloud APIs from GKE workloads](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) - Shows direct Kubernetes principal bindings, IAM service account impersonation, and Kubernetes ServiceAccount annotations.
- [Google Cloud: Troubleshoot IAM access](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) - Documents Policy Troubleshooter for checking a principal, resource, and permission together.
