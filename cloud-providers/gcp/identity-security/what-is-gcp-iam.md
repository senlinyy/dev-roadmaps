---
title: "What Is GCP IAM"
description: "Understand how GCP IAM checks principals, permissions, roles, allow policies, scopes, conditions, deny policies, principal access boundaries, and troubleshooting evidence."
overview: "GCP IAM decides whether a human, service account, or federated workload can use a specific permission on a specific resource. This foundation article follows devpolaris-orders-api on Cloud Run as Google Cloud checks its caller, role binding, scope, condition, guardrails, and policy evidence."
tags: ["gcp", "iam", "security", "authorization"]
order: 1
id: article-cloud-providers-gcp-identity-security-gcp-identity-security-mental-model
aliases:
  - gcp-identity-security-mental-model
  - principals-iam-roles-and-policy-bindings
  - permission-failures-and-access-reviews
  - article-cloud-providers-gcp-identity-security-principals-iam-roles-policy-bindings
  - article-cloud-providers-gcp-identity-security-permission-failures-access-reviews
  - cloud-providers/gcp/identity-security/gcp-identity-security-mental-model.md
  - cloud-providers/gcp/identity-security/principals-iam-roles-and-policy-bindings.md
  - cloud-providers/gcp/identity-security/permission-failures-and-access-reviews.md
---

## Table of Contents

1. [Start With the Access Question](#start-with-the-access-question)
2. [Principals: Who Is Calling](#principals-who-is-calling)
3. [The Runtime Service Account in Our Scenario](#the-runtime-service-account-in-our-scenario)
4. [Resource Hierarchy: Where the Grant Lives](#resource-hierarchy-where-the-grant-lives)
5. [Permissions and Roles: What the Caller Needs](#permissions-and-roles-what-the-caller-needs)
6. [Allow Policies and Role Bindings](#allow-policies-and-role-bindings)
7. [IAM Conditions](#iam-conditions)
8. [Deny Policies and Principal Access Boundaries](#deny-policies-and-principal-access-boundaries)
9. [Following One Denied Request](#following-one-denied-request)
10. [Troubleshooting With Policy Evidence](#troubleshooting-with-policy-evidence)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## Start With the Access Question
<!-- section-summary: GCP IAM answers one request at a time by checking the caller, permission, resource, policy scope, and guardrails. -->

**Google Cloud IAM** is the access-control system Google Cloud uses to decide whether a caller can perform an action on a resource. A caller might be a person in the console, a Terraform pipeline, a Cloud Run service, or an external workload that federates into Google Cloud.

The basic question sounds small: can this caller do this action here? Under the hood, Google Cloud breaks that question into a few concrete pieces: the **principal** that made the request, the **permission** required by the API method, the **resource** being touched, the **allow policies** attached to that resource and its parents, and any guardrails such as **IAM Conditions**, **deny policies**, or **principal access boundary policies**.

We will use one production-style service throughout the article. `devpolaris-orders-api` runs on Cloud Run in `projects/devpolaris-prod`, and its runtime service account is `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`. The service needs to read the Secret Manager secret `orders-db-password`, write export files into the Cloud Storage bucket `devpolaris-order-exports-prod`, publish order messages to the Pub/Sub topic `order-events`, and connect to the Cloud SQL instance `orders-prod`.

That service gives us a real path through IAM. A single denied Secret Manager request can show every important piece: who called, which permission was required, where the binding should live, whether the role contains the permission, whether a condition matched, whether a guardrail blocked access, and what evidence Google Cloud gives you when you troubleshoot the result.

| Piece | Plain English Meaning | Example From This Article |
|---|---|---|
| **Principal** | The authenticated caller | `serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com` |
| **Permission** | The granular API action needed | `secretmanager.versions.access` |
| **Role** | A named bundle of permissions | `roles/secretmanager.secretAccessor` |
| **Allow policy** | The resource-attached grant document | A policy on `orders-db-password` |
| **Role binding** | The link between principal and role | Runtime service account gets Secret Accessor |
| **Scope** | Where the policy is attached | Secret, bucket, topic, project, folder, or organization |
| **Condition** | Extra context that must be true | Only allow access before a timestamp or for one resource name |
| **Guardrail** | A policy that limits or blocks access | Deny policy or principal access boundary |
| **Evidence** | The explanation used for debugging | Policy Troubleshooter output and audit logs |

## Principals: Who Is Calling
<!-- section-summary: A principal is the authenticated identity in an IAM decision, and finding the exact principal is the first step in every access investigation. -->

A **principal** is the identity that Google Cloud sees on the request. IAM uses principals for both humans and workloads, so the caller could be a developer, a team group, a whole domain, a service account, or an identity from another system that Google Cloud trusts through federation.

The most familiar principal is a **user**, written like `user:maya@devpolaris.com`. This usually represents a human account from Google Workspace, Cloud Identity, or a Google Account. A user signs in to the console, runs `gcloud`, approves a deployment, or reads logs during an incident.

A **Google group** is written like `group:gcp-platform-admins@devpolaris.com`. Groups make human access easier to manage because IAM policy can mention the group once, and the identity team can add or remove people from the group as jobs change. In production, teams usually grant roles to groups for human access instead of granting the same role to ten individual users.

A **domain** principal is written like `domain:devpolaris.com`. It represents identities in a Google Workspace or Cloud Identity domain, so it is much broader than a group. Domain grants need extra care because a future employee or service identity in that domain can inherit access without anyone editing the IAM policy again.

A **service account** is written like `serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`. This is the main workload principal in our scenario. Cloud Run uses the service account attached to `devpolaris-orders-api` when the container calls Google APIs, so IAM checks the service account rather than the developer who deployed the service.

A **federated identity** comes from an external identity provider and maps into Google Cloud through workforce identity federation or workload identity federation. Workforce federation is common for contractors or employees signing in from an external identity provider. Workload federation is common for GitHub Actions, GitLab CI, Kubernetes workloads, or another cloud provider calling Google Cloud with short-lived federated access.

The first access-debugging habit is to ask, "Which principal actually made the request?" A developer might test locally as `user:maya@devpolaris.com` and succeed, while Cloud Run fails in production as `serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`. IAM can only evaluate the caller on the actual request, so the exact principal matters more than the person who wrote the code.

## The Runtime Service Account in Our Scenario
<!-- section-summary: Cloud Run workload access should come from the runtime service account, with human accounts and long-lived key files kept out of the runtime path. -->

For `devpolaris-orders-api`, the caller we care about is the runtime service account. Cloud Run can attach a service account to a service, and the Google Cloud client libraries in the container use Application Default Credentials to obtain credentials for that service account. The application code calls Secret Manager, Cloud Storage, Pub/Sub, and Cloud SQL connectors while the container filesystem stays free of JSON key files.

This detail matters because the service account starts with only the permissions it receives through IAM. The email address can look official and production-ready, and the identity still needs explicit grants before it can read secrets, create objects, publish messages, or connect to databases. Each action needs a role binding at a scope that covers the target resource.

In a healthy setup, deployment and runtime use different principals. A CI/CD service account might deploy the Cloud Run service, while `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com` handles only the permissions needed while the service is running. This separation helps incident response because a compromised runtime identity has a smaller blast radius and keeps deployment authority separate.

So our access design starts with one workload identity and a short list of production tasks. The service reads one database password secret, writes order export files, publishes order events, and connects to one Cloud SQL instance. Now we need to decide where those grants live in the Google Cloud resource hierarchy.

## Resource Hierarchy: Where the Grant Lives
<!-- section-summary: Google Cloud resources sit under organizations, folders, and projects, and IAM allow policies inherit from parents to children. -->

The **resource hierarchy** is the parent-child structure Google Cloud uses for resources. At the top, an **organization** represents the company. Under that, **folders** can group departments, environments, or business units. Under folders, **projects** hold most service resources and act as a common trust, billing, and administration boundary.

Our example project is `projects/devpolaris-prod`. Inside that project, the service touches individual resources: the Secret Manager secret `orders-db-password`, the Cloud Storage bucket `devpolaris-order-exports-prod`, the Pub/Sub topic `order-events`, and the Cloud SQL instance `orders-prod`. IAM looks at the target resource and also looks upward through the resource's ancestors.

Allow policies inherit downward. A binding at the organization can affect folders, projects, and resources underneath it. A binding at `projects/devpolaris-prod` can affect many resources in that project. A binding directly on `orders-db-password`, when the service supports that resource-level policy, narrows the grant to that one resource.

That scope choice controls blast radius. If the runtime service account receives `roles/secretmanager.secretAccessor` at `projects/devpolaris-prod`, it can access every secret in that project where the role applies. If it receives the same role on the `orders-db-password` secret, it can read only that secret, which is a much better fit for a service that needs one database password.

Some Google Cloud resources accept their own allow policies, and some rely on inherited policies from a parent such as a project. This is why production IAM design usually starts with the narrowest supported scope, then moves one level up only when the service or workflow requires it. The target resource still matters even when the binding lives on an ancestor, because IAM checks whether the inherited role contains the permission needed for that target.

For `devpolaris-orders-api`, a practical first pass looks like this:

| Task | Target Resource | Narrow Scope To Prefer |
|---|---|---|
| Read the database password | Secret `orders-db-password` | Secret-level binding when available |
| Write order export files | Bucket `devpolaris-order-exports-prod` | Bucket-level binding |
| Publish order events | Topic `order-events` | Topic-level binding |
| Connect to Cloud SQL | Instance `orders-prod` | Project-level Cloud SQL connectivity grant in `projects/devpolaris-prod` |

## Permissions and Roles: What the Caller Needs
<!-- section-summary: Google Cloud APIs check granular permissions, and IAM grants those permissions through role bundles. -->

A **permission** is the smallest IAM action that a Google Cloud API checks. Permission names usually follow a service, resource type, and verb pattern, such as `pubsub.topics.publish` or `secretmanager.versions.access`. Many permissions map closely to API methods, so calling a method usually requires the matching permission on the resource.

You normally grant permissions through **roles**, and a role is a named collection of permissions. This keeps day-to-day access management focused on job-shaped bundles instead of hundreds of separate API actions. When you bind a role to a principal, the principal receives all permissions in that role at the scope covered by the binding.

Here are the permissions our Cloud Run service needs for its core production tasks:

| Service Task | Permission Google Cloud Checks | Common Predefined Role |
|---|---|---|
| Access the secret payload for `orders-db-password` | `secretmanager.versions.access` | `roles/secretmanager.secretAccessor` |
| Create new objects in `devpolaris-order-exports-prod` | `storage.objects.create` | `roles/storage.objectCreator` |
| Publish to the `order-events` topic | `pubsub.topics.publish` | `roles/pubsub.publisher` |
| Connect through Cloud SQL Auth Proxy or connectors | `cloudsql.instances.connect` and `cloudsql.instances.get` | `roles/cloudsql.client` |

Google Cloud has three main role types. **Predefined roles** are managed by Google Cloud services and usually match common job functions, such as publishing to Pub/Sub or accessing Secret Manager payloads. They are a good starting point because Google updates them as services change.

**Custom roles** are roles your organization creates from a selected list of supported permissions. They help when a predefined role grants more than a workload should have, and they bring maintenance work. When Google Cloud adds a new API feature or permission, your custom role needs a review and update before it includes that new permission.

**Basic roles** include broad roles such as Owner, Editor, and Viewer. These roles grant wide access across many services and are too large for production workload identity in almost every normal case. They can still appear during early testing or account bootstrap, while `devpolaris-orders-api` should use limited predefined or custom roles for its runtime access.

The role choice and the binding scope work together. `roles/storage.objectCreator` on one bucket lets the service create objects there, which fits a one-way export workflow. The same role on the project lets the service create objects in buckets across the project, which might be more access than the application needs.

## Allow Policies and Role Bindings
<!-- section-summary: An allow policy is attached to a resource and contains role bindings that connect principals to roles, optionally with conditions. -->

An **allow policy** is the IAM policy document attached to a Google Cloud resource. The policy contains **role bindings**, and each binding connects one or more principals to one role. In older APIs and examples, principals are often called **members**, so you will still see the `members` field in JSON policy output.

Here is a small allow-policy shape for the Secret Manager secret `orders-db-password`. The important part is the binding: the runtime service account receives `roles/secretmanager.secretAccessor`, and that role contains the `secretmanager.versions.access` permission needed to read a secret version payload.

```json
{
  "bindings": [
    {
      "role": "roles/secretmanager.secretAccessor",
      "members": [
        "serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com"
      ]
    }
  ]
}
```

That JSON only makes sense together with its attachment point. If the policy is attached to the `orders-db-password` secret, the binding is narrow. If the same binding is attached to `projects/devpolaris-prod`, the service account can access every secret in the project where that inherited role applies.

Google Cloud evaluates the **effective allow policy** for the target resource. The effective policy includes the resource's own allow policy plus inherited allow policies from parents such as the project, folder, and organization. If any applicable binding grants a role that contains the required permission, the allow side of the decision can pass.

Automation tools need to handle allow-policy updates carefully because policy updates replace a policy document as a whole. Google Cloud uses an `etag` on allow policies to prevent concurrent writers from overwriting each other. Terraform, `gcloud`, and the console handle much of this for normal workflows, and custom automation should read the policy, modify it, and write it back with the current `etag`.

## IAM Conditions
<!-- section-summary: IAM Conditions add context to a role binding so the role applies only when the condition expression is true. -->

An **IAM Condition** is an expression on a role binding that must evaluate to true before the binding grants the role. Conditions let you use request and resource attributes, such as request time, resource name, resource type, resource service, and tags. They are useful when the right role is still too broad unless extra context narrows it.

For example, imagine the orders team temporarily grants a migration service account permission to write order exports for one weekend. A condition can use `request.time` so the binding stops granting access after a fixed timestamp. The role binding stays visible in the policy, and it applies only while the expression passes.

Conditions can also narrow a broader binding to a resource pattern. If a team has to grant a role at the project level, a condition can check `resource.name` or `resource.type` so the binding applies only to the intended resource shape. This pattern needs careful testing because the condition attribute values must match the service's documented resource-name format.

```json
{
  "role": "roles/storage.objectCreator",
  "members": [
    "serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com"
  ],
  "condition": {
    "title": "OnlyOrderExportObjects",
    "description": "Allow object creation only in the production order export bucket.",
    "expression": "resource.type == 'storage.googleapis.com/Object' && resource.name.startsWith('projects/_/buckets/devpolaris-order-exports-prod/')"
  }
}
```

For a beginner, the key idea is simple: a conditional binding still has a principal, a role, and a scope, and the role applies only when the expression returns true. During troubleshooting, this means a binding can include the right principal and the right role while still failing because the time window expired, the resource name missed the expected pattern, or the request context lacked the attribute the condition expected.

When using the REST API or client libraries, conditional allow policies use policy version 3 so the condition appears in the policy response. The console and `gcloud` handle this detail for common workflows. Custom tools should request and write the version that preserves conditions, because losing a condition can accidentally broaden access.

## Deny Policies and Principal Access Boundaries
<!-- section-summary: Deny policies block permissions at resource scopes, while principal access boundaries limit which resources selected principals are eligible to access. -->

Allow policies grant access. Production environments also need guardrails around those grants. Google Cloud gives you two important guardrail tools at beginner level: **deny policies** and **principal access boundary policies**. They solve different problems, so it helps to separate them before using either one.

A **deny policy** contains deny rules that block selected principals from using selected permissions. IAM checks relevant deny policies before checking allow policies. If a deny rule matches the principal and permission, the request is denied even if an allow binding grants a role with that permission.

Deny policies attach to organizations, folders, or projects, and they inherit downward through the hierarchy. A security team might attach a deny policy at the organization to stop most principals from deleting projects, changing custom roles, or creating service account keys. The policy can include exceptions for a tightly controlled admin group when the business needs a break-glass path.

A **principal access boundary policy**, often shortened to **PAB**, controls which resources a set of principals is eligible to access. It attaches to principal sets through policy bindings, so it follows selected principals across resource boundaries. A PAB is an eligibility boundary; allow policies still perform the grant.

For example, DevPolaris could use a PAB so service accounts from `projects/devpolaris-prod` are eligible to access only resources inside the DevPolaris organization or inside an approved production project set. If someone accidentally grants `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com` a role on an external project, the PAB can prevent access for permissions that PAB enforcement covers. The allow binding might exist, but the principal is outside its eligible resource boundary.

At this stage, treat deny policies and PABs as broad guardrails around the normal allow-policy grants. For `devpolaris-orders-api`, the normal grant still comes from allow policies. Deny policies and PABs help the platform team prevent dangerous actions and keep workload identities inside approved resource areas.

## Following One Denied Request
<!-- section-summary: A denied Secret Manager request shows IAM checking caller identity, permission, scope, role binding, conditions, and guardrails in one path. -->

Now let's follow a real failed request. `devpolaris-orders-api` starts on Cloud Run and tries to load its database password from Secret Manager. The application asks for the latest version of `orders-db-password`, and the request comes back with `403 PERMISSION_DENIED`.

The first question is the caller. The deployed request comes from Cloud Run's runtime identity. Cloud Run calls as `serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`, because that is the runtime service account attached to the service.

The second question is the permission. Reading a Secret Manager payload requires `secretmanager.versions.access` on the secret version resource. A role such as `roles/secretmanager.viewer` can let someone view metadata, while payload access still requires the Secret Accessor permission path.

The third question is the resource. The target lives under `projects/devpolaris-prod`, and the resource path points to the `orders-db-password` secret version. IAM can consider an allow policy on the secret itself, plus inherited allow policies from the project, folder, and organization.

The fourth question is guardrails. A deny policy on the project or an ancestor could block `secretmanager.versions.access` for this service account. A principal access boundary could also make the service account ineligible to access this resource. If either guardrail blocks the request, another allow binding leaves the denial in place.

The fifth question is the allow evidence. IAM looks for a role binding that includes the runtime service account and grants a role containing `secretmanager.versions.access` at a scope that covers the secret. If the only binding is for `serviceAccount:orders-api-deploy@devpolaris-prod.iam.gserviceaccount.com`, then the deployer can manage deployment work while the runtime request remains denied.

The sixth question is condition evidence. The binding might name the right service account and the right role, and a condition can still stop it from applying. A condition could require a resource-name prefix that misses the Secret Manager version, or it could have a time window that expired after a migration.

A narrow fix for the common missing-binding case can look like this:

```bash
gcloud secrets add-iam-policy-binding orders-db-password \
  --project=devpolaris-prod \
  --member="serviceAccount:orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

This binds the Secret Accessor role to the runtime service account on one secret. After IAM propagation, the same Secret Manager request has the principal, permission, role, binding, and scope lined up. The application can read `orders-db-password`, and the rest of the project secrets stay outside its grant.

The other service permissions follow the same pattern. The runtime service account needs `roles/storage.objectCreator` on `devpolaris-order-exports-prod` so it can create export objects. It needs `roles/pubsub.publisher` on `order-events` so it can publish messages. It needs `roles/cloudsql.client` in `projects/devpolaris-prod` so Cloud SQL connectors or the Cloud SQL Auth Proxy can connect to `orders-prod`.

## Troubleshooting With Policy Evidence
<!-- section-summary: Policy Troubleshooter explains access decisions by showing allow, deny, PAB, role, principal, permission, resource, and condition evidence. -->

Guessing at IAM is slow because a denied request can come from the wrong principal, a missing permission, a broad grant at the wrong place, a condition that failed, a deny policy, or a principal access boundary. **Policy Troubleshooter** helps by asking the same access question directly: can this principal use this permission on this resource?

For the Secret Manager failure, the access tuple has three required parts: the principal email, the full resource name, and the permission. A troubleshooting query can use the Google Cloud CLI, and the `beta` version includes principal access boundary policy evaluation. The audit log might show a concrete secret version such as `versions/5`, even when application code asked for the `latest` version alias.

```bash
gcloud beta policy-intelligence troubleshoot-policy iam \
  "//secretmanager.googleapis.com/projects/devpolaris-prod/secrets/orders-db-password/versions/5" \
  --principal-email="orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com" \
  --permission="secretmanager.versions.access"
```

The useful output includes more than the final allowed or denied result. The explanation shows whether an allow policy contains a relevant binding, whether the binding includes the principal, whether the role includes the permission, whether a condition evaluated to true, whether a deny rule matched, and whether a principal access boundary allowed the resource. That evidence can point to "the binding names the deployer service account instead of the runtime service account."

Audit logs add another layer of evidence. An Admin Activity or Data Access log entry can show the request time, caller, method, resource, and error details. Troubleshooting from a log entry gives Policy Troubleshooter more request context for conditions, which helps when a condition depends on time, tags, resource attributes, or other request facts.

There are still limits to remember. If you lack permission to view a parent policy, a custom role, group membership, domain membership, or a principal access boundary, the tool may report part of the evidence as unknown. That unknown result is useful in its own way because it tells you the investigation needs more visibility before you can trust the final answer.

## Putting It All Together
<!-- section-summary: A good GCP IAM design keeps the runtime identity narrow, grants roles at the smallest supported scope, and uses evidence to debug access. -->

By the end of the setup, `devpolaris-orders-api` has one clear runtime identity: `orders-api-runtime@devpolaris-prod.iam.gserviceaccount.com`. That identity receives only the roles needed for the application to run. Human deployers, CI/CD deployers, and runtime code can stay separated by job.

The service account gets `roles/secretmanager.secretAccessor` on the single `orders-db-password` secret. It gets `roles/storage.objectCreator` on the `devpolaris-order-exports-prod` bucket for one-way export writes. It gets `roles/pubsub.publisher` on the `order-events` topic. It gets `roles/cloudsql.client` in `projects/devpolaris-prod` for Cloud SQL connectivity to `orders-prod`.

The platform team can add guardrails above that workload access. A deny policy can stop broad dangerous actions such as service account key creation or project deletion across production. A principal access boundary can keep selected service accounts eligible only for approved resources, which helps when accidental grants appear outside the intended project or organization.

The debugging workflow is the same every time. Identify the exact principal, identify the permission required by the API call, identify the target resource, inspect effective allow policies from the resource and ancestors, check conditions, check deny policies, check principal access boundaries, and use Policy Troubleshooter plus audit logs for evidence. That workflow makes IAM a readable request path instead of a pile of disconnected permission screens.

## What's Next

The next article can build on this foundation by focusing on service accounts in daily work. That topic deserves its own space because runtime identities, Application Default Credentials, workload identity federation, service account impersonation, and key-file risk shape how applications authenticate before IAM ever checks authorization.

---

**References**

- [Google Cloud: IAM overview](https://docs.cloud.google.com/iam/docs/overview) - Explains principals, roles, permissions, allow policies, deny policies, principal access boundaries, and IAM Conditions.
- [Google Cloud: Understanding allow policies](https://docs.cloud.google.com/iam/docs/allow-policies) - Defines allow policies, role bindings, principals, roles, conditions, inheritance, and policy versions.
- [Google Cloud: Roles and permissions](https://docs.cloud.google.com/iam/docs/roles-overview) - Describes permissions, predefined roles, custom roles, and basic roles.
- [Google Cloud: Using resource hierarchy for access control](https://docs.cloud.google.com/iam/docs/resource-hierarchy-access-control) - Explains organizations, folders, projects, resources, inheritance, and effective allow policies.
- [Google Cloud: Principal identifiers](https://docs.cloud.google.com/iam/docs/principal-identifiers) - Lists principal formats for users, groups, domains, service accounts, workforce identities, and workload identities.
- [Google Cloud: Overview of IAM Conditions](https://docs.cloud.google.com/iam/docs/conditions-overview) - Documents conditional role bindings, CEL expressions, request attributes, resource attributes, and tag-based conditions.
- [Google Cloud: Deny policies](https://docs.cloud.google.com/iam/docs/deny-overview) - Describes deny rules, denied principals, denied permissions, exceptions, attachment points, and deny-before-allow behavior.
- [Google Cloud: Principal access boundary policies](https://docs.cloud.google.com/iam/docs/principal-access-boundary-policies) - Explains how PAB policies define the resources that principals are eligible to access.
- [Google Cloud: Troubleshoot IAM permissions](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) - Shows how Policy Troubleshooter evaluates principals, resources, permissions, allow policies, deny policies, PAB policies, and conditions.
- [Google Cloud: Cloud SQL IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudsql) - Lists Cloud SQL roles and permissions, including `roles/cloudsql.client`.
