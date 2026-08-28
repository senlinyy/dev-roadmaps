---
title: "What Is GCP IAM"
description: "Understand how Google Cloud IAM checks callers, permissions, resources, roles, allow policies, bindings, hierarchy, and conditions."
overview: "GCP IAM answers a plain access question for every request: who is calling, what are they trying to do, and which resource are they touching. The examples follow a checkout API reading one orders bucket and a human performing time-limited incident work."
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

1. [What Question Does GCP IAM Answer?](#what-question-does-gcp-iam-answer)
2. [Who Is the Principal on the Request?](#who-is-the-principal-on-the-request)
3. [Which Resource and Permission Does the Request Use?](#which-resource-and-permission-does-the-request-use)
4. [How Do Roles Bundle Permissions for a Job?](#how-do-roles-bundle-permissions-for-a-job)
5. [How Do Allow Policies, Bindings, and Inheritance Create a Grant?](#how-do-allow-policies-bindings-and-inheritance-create-a-grant)
6. [How Do Conditions, Deny Policies, and Boundaries Limit Access?](#how-do-conditions-deny-policies-and-boundaries-limit-access)
7. [How Should AWS Readers Translate the IAM Vocabulary?](#how-should-aws-readers-translate-the-iam-vocabulary)
8. [How Do You Debug a Denied Request and Apply Least Privilege?](#how-do-you-debug-a-denied-request-and-apply-least-privilege)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Google Cloud IAM is the access-control system that decides whether a caller may use a Google Cloud API on a Google Cloud resource. The plain version of the question is direct: **who is calling, what are they trying to do, and which resource are they touching?** Every IAM topic in this module fits somewhere inside that question.

Picture Acme's checkout application. A Cloud Run service named `checkout-api` reads an invoice object from a Cloud Storage bucket named `orders-prod`. Alice is the human who deployed the service, but the runtime call reaches Storage as `checkout-api@acme-prod.iam.gserviceaccount.com`. IAM must evaluate the identity on that particular request rather than the person who owns the application.

The beginner version is like access at a workplace. A person or service presents an identity, asks to do a task, and touches a specific room or file. The decision is different for "Alice may deploy the service" and "the checkout service may read an invoice." IAM turns those plain access sentences into policies Google Cloud can evaluate on every API request.

Keep these questions in view as you work through the lesson:

1. **What Question Does GCP IAM Answer?**
2. **Who Is the Principal on the Request?**
3. **Which Resource and Permission Does the Request Use?**
4. **How Do Roles Bundle Permissions for a Job?**
5. **How Do Allow Policies, Bindings, and Inheritance Create a Grant?**
6. **How Do Conditions, Deny Policies, and Boundaries Limit Access?**
7. **How Should AWS Readers Translate the IAM Vocabulary?**
8. **How Do You Debug a Denied Request and Apply Least Privilege?**

## What Question Does GCP IAM Answer?
<!-- section-summary: GCP IAM answers who is calling, what action they want, and which resource the request touches. -->

IAM therefore belongs to application and platform design as well as security operations. Every production service uses it. The runtime identity of a Cloud Run service, the deploy identity in CI, the analyst opening logs, and the automation rotating secrets all produce IAM decisions. If the article teaches only role names, the reader still cannot debug the denied request. The access question gives the debugging shape.

Those two jobs need different access. The checkout service should read objects from one bucket, and it should not administer the whole project. Alice's deployment access should not silently become the workload's runtime access. IAM lets you describe those jobs as principals, resources, permissions, roles, policies, bindings, hierarchy, and conditions.

Authentication comes first: Google establishes which human, group, service account, or federated workload is calling. Authorization then asks whether that principal may use a particular permission on a particular resource under the current policy context. The everyday grant equation is `principal + role + resource + optional condition`. Modern evaluation can also include deny policies and principal access boundaries before the final allow-or-deny result.

![IAM request path](/content-assets/articles/article-cloud-providers-gcp-identity-security-gcp-identity-security-mental-model/iam-request-path.png)
*An IAM decision follows the request: caller, action, target resource, applicable grants, and any extra rules on those grants.*

## Who Is the Principal on the Request?
<!-- section-summary: A principal is the identity that Google Cloud sees on the request. -->

A **principal** is the authenticated identity that makes a request. A principal can be a human user, a Google group, a service account, a domain, or a federated identity from another identity provider. IAM decisions always need the actual principal on the request, because two callers can run the same command and receive different results.

Think of a principal as the name on the request envelope. Google Cloud does not decide access from the laptop, browser, or container alone. It decides from the authenticated identity attached to the API call. That identity might be Alice signing in as a human, a Cloud Run service account reading an object, or a CI/CD service account deploying a new revision.

This is why "the app has access" is too vague. Which app identity? The service account attached to Cloud Run? The CI account that deployed it? A human who tested the command locally? A clear access review names the exact principal because audit logs and IAM policies use that identity.

For the checkout application, the runtime principal is the service account attached to Cloud Run:

`serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com`

Alice's human identity is a different principal:

`user:alice@example.com`

Groups help manage human access. Instead of granting log access to each analyst one by one, the team can grant a role to `group:prod-observers@example.com` and manage membership through the company identity process. For software, dedicated service accounts keep workload access separate from human access and make audit logs easier to read.

## Which Resource and Permission Does the Request Use?
<!-- section-summary: A resource is the Google Cloud object the request wants to read, change, create, or delete. -->

A **resource** is the thing the request touches. It might be a project, folder, bucket, secret, log bucket, Pub/Sub topic, Cloud Run service, or one object inside a service. IAM needs the resource because access is not only about the caller. It is also about the target.

Use a building-access picture. A badge that opens one storage room is very different from a badge that opens the whole building. The person holding the badge may be the same, and the action may still be "open a door," but the target changes the risk. IAM works the same way. A role on one bucket is a narrow storage-room grant. A role on a project can reach many resources inside that project.

That is why resource scope is a beginner concept, not an advanced detail. If you grant access at the wrong resource level, the role may technically work while the security design is still wrong.

The checkout service needs the bucket:

`projects/_/buckets/orders-prod`

Alice's separate investigation job may need logging resources in the production project:

`projects/acme-prod`

Those targets should stay separate. Object-read access belongs on the bucket for a workload that only reads order evidence there. Log viewing access belongs on the project or log view that covers an investigation workflow. If both callers receive broad project roles, the policy stops saying what each job actually needs.

### Permission Is the Exact Action
<!-- section-summary: A permission is the smallest IAM action a Google Cloud API checks. -->

A **permission** is the exact API action required for an operation. It is the smallest action IAM checks, such as create an object, list log entries, update a service, or access a secret payload. You usually do not grant permissions one by one, yet the API check still happens at this level.

Think of a role as a job-shaped permission bundle and a permission as one task inside it. "Storage Object Viewer" is the bundle. `storage.objects.get` is the exact operation the Cloud Storage API needs to return one object. During troubleshooting, the missing permission tells you the exact task that failed. During design, the role should still describe a job a human can review.

For order reads, Cloud Storage checks for an object-read permission. For Alice's log search, Cloud Logging checks for log-viewing permissions.

Here is the shape of the two jobs:

| Job | Resource | Permission idea |
|---|---|---|
| Checkout API reads an invoice | Bucket `orders-prod` | Read objects from the bucket. |
| Production investigator reads logs | Project or log view for `acme-prod` | View log entries and related metadata. |

Permission names often look service-shaped, such as `storage.objects.get` or `logging.logEntries.list`. That naming is useful during troubleshooting because an error message may say which permission was missing. The fix should still grant a job-shaped role at the narrowest useful scope instead of handing out a broad admin role.

## How Do Roles Bundle Permissions for a Job?
<!-- section-summary: A role packages permissions into a named access bundle that can be granted to a principal. -->

A **role** is a named bundle of permissions. Google Cloud provides predefined roles for common jobs, such as object reading in Cloud Storage or viewing logs in Cloud Logging. Your organization can also create custom roles if predefined roles grant more than the job needs.

The checkout service can use `roles/storage.objectViewer` on the `orders-prod` bucket. That role is a good fit for a read-only service because it allows object retrieval without handing the workload a broad administration role across the whole project.

Alice can use a logging viewer role that fits the support process. If the support team only needs application logs, a narrower log view plus a viewer role can reduce exposure compared with project-wide broad access. The key habit is to describe the job first, then pick the smallest role and scope that covers that job.

Basic roles such as Owner, Editor, and Viewer are too broad for most production work. They may appear in old projects or early experiments, yet they hide the real access story. A production service named `checkout-api` should not need a role that can edit unrelated services, buckets, secrets, networks, and IAM policies.

Permissions are deliberately granular: `compute.instances.get`, `compute.instances.stop`, `storage.objects.get`, and `pubsub.topics.publish` describe different capabilities. Google normally grants them through roles rather than one by one. Predefined roles are Google-maintained bundles for common service jobs. Custom roles let the organization maintain a supported permission set when predefined roles are too broad. Basic roles span many services and should be avoided for precise production grants.

An IAM role is not a company job title and is not an identity. One engineer may receive several roles for logging, deployment, and artifact access. The most important design questions remain which permissions the bundle contains and where it is granted. A narrow role at organization scope may still be dangerous, while a powerful role on one tightly bounded resource may have a smaller blast radius.

## How Do Allow Policies, Bindings, and Inheritance Create a Grant?
<!-- section-summary: An allow policy is attached to a resource and stores the role grants for that resource. -->

An **allow policy** is the IAM policy attached to a Google Cloud resource. The policy contains metadata and one or more bindings. Google Cloud evaluates the policies attached to the target resource and its parents to decide whether a principal has a role that includes the required permission.

For the checkout service, the strongest first shape is a policy on the bucket. That policy can say that only the checkout service account receives object-read access on `orders-prod`. A project-level policy would reach more resources, so it needs a stronger reason.

The policy document itself is not the whole story. Its attachment point matters just as much as its contents. The same binding on one bucket is narrow. The same binding on a project can cover many buckets. The same binding on a folder can cover many projects.

Compare the same grant in two places. The narrow version lives on the bucket policy:

```yaml
resource: //storage.googleapis.com/projects/_/buckets/orders-prod
bindings:
- role: roles/storage.objectViewer
  members:
  - serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com
```

The broader version lives on the project policy:

```yaml
resource: //cloudresourcemanager.googleapis.com/projects/acme-prod
bindings:
- role: roles/storage.objectViewer
  members:
  - serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com
```

The member and role stay the same. The attachment point changes the blast radius. The bucket policy lets `checkout-api` read objects in `orders-prod`. The project policy can apply to Cloud Storage buckets in `acme-prod` where that role is honored through project-level IAM, including future buckets unless another control blocks the request.

A quick review should check both places:

```bash
gcloud storage buckets get-iam-policy gs://orders-prod \
  --format='table(bindings.role,bindings.members)'

gcloud projects get-iam-policy acme-prod \
  --flatten='bindings[].members' \
  --filter='bindings.members:checkout-api@acme-prod.iam.gserviceaccount.com' \
  --format='table(bindings.role,bindings.members)'
```

- The bucket command should show the object-viewer role on the bucket that needs reads.
- The project command should return nothing for that same Storage reader grant unless the team has approved project-wide bucket access.
- If the project command shows the role, the reviewer should ask which other buckets the checkout service can touch and why the grant belongs at project scope.

### A Binding Links Principals to a Role
<!-- section-summary: A binding connects a principal to a role, optionally with a condition. -->

A **binding** is the part of an allow policy that connects one or more principals to one role. Older IAM output often calls principals `members`, so you may see `members` in JSON and YAML policy results.

The binding is the actual sentence inside the policy: this principal gets this role here. The role by itself grants nothing. The principal by itself grants nothing. The resource policy by itself is only a document. The binding links them together so Google Cloud can answer the request.

For beginners, this is the point where IAM stops being abstract. You can point at one binding and ask: who receives access, what role did they receive, and which resource stores the grant? If any of those three pieces are broader than the job, the access design needs review.

The checkout bucket binding can be created with the Google Cloud CLI after the service account and bucket already exist:

```bash
gcloud storage buckets add-iam-policy-binding gs://orders-prod \
  --member="serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

- `gs://orders-prod` is the resource receiving the allow-policy change.
- `--member` names the workload principal that will call Cloud Storage.
- `--role` grants a predefined role that includes object reading without broad project administration.

A healthy result should show a binding like this:

```yaml
bindings:
- members:
  - serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com
  role: roles/storage.objectViewer
etag: BwYh2mQ9cJ0=
```

- The role and member appear together, which means the policy now has the binding.
- The `etag` protects policy updates from accidental overwrite by concurrent changes.
- The output should name the service account that actually runs the Cloud Run service, not the human who deployed it.

### Inheritance Changes the Effective Scope
<!-- section-summary: Google Cloud resources sit in a hierarchy, and allow policies can inherit from parent resources to children. -->

The **resource hierarchy** is the parent-child structure that organizes Google Cloud resources. An organization can contain folders, folders can contain projects, and projects contain service resources such as buckets, secrets, topics, services, and log buckets.

Allow policies inherit downward. A role granted on an organization can affect folders and projects below it. A role granted on a production folder can affect every production project inside that folder. A role granted directly on a bucket affects that bucket without granting the same access to every bucket in the project.

For the checkout application, inheritance is the reason the bucket-level binding is safer than a project-level grant. The service account only needs to read objects in `orders-prod`. A project-level Storage role might cover other buckets, including private exports or security evidence that the checkout service should never touch.

Alice's log access may need a wider scope because support investigations often cross several Cloud Run revisions and log streams inside one project. Even then, the team should decide whether the access belongs on the project, a log view, or a support group rather than granting unrelated roles directly to one user.

Inherited allow access is additive. If Alice receives Storage Viewer at the organization, omitting Alice from a child project's local policy does not cancel the ancestor grant. Effective access is the union of applicable bindings on the resource and its ancestors. That is why investigators must inspect organization, folder, project, group membership, and resource-level paths rather than stare at one local policy entry.

Groups make human grants durable. Instead of wiring seventy people directly into infrastructure policies, grant the investigation roles to `prod-observers@example.com` and manage employment and team changes through group membership. Software needs the same separation: `checkout-api`, `payment-worker`, and `report-generator` should have distinct service accounts and permissions rather than sharing one super-admin identity.

## How Do Conditions, Deny Policies, and Boundaries Limit Access?
<!-- section-summary: An IAM Condition adds a context expression that must pass before a binding grants access. -->

An **IAM Condition** is an extra rule on a binding. The binding still has a principal, role, and scope, and the condition controls whether that binding applies. Conditions can use attributes such as request time, resource name, resource type, and resource tags if the target service supports conditional role bindings.

Think of a condition as a checked note attached to the grant. The policy still says Alice receives the incident role, and the condition adds "only before this approved end time." This is useful for temporary access and tightly scoped operational windows.

Conditions are powerful because they let a reviewed grant carry more context than principal plus role. They are also easy to over-trust. A condition on a broad project role can still create too much access if the expression misses the real resource boundary. The safer order is: choose a narrow resource, choose the smallest useful role, then add a condition for time, resource name, or tag constraints.

Imagine Acme approves Alice to inspect order evidence until the end of an incident window. A condition can make the binding stop applying after the recorded deadline.

```json
{
  "role": "roles/storage.objectViewer",
  "members": [
    "user:alice@example.com"
  ],
  "condition": {
    "title": "IncidentResponseWindow",
    "description": "Temporary object reading for the approved incident-response window.",
    "expression": "request.time < timestamp(\"2026-07-06T08:00:00Z\")"
  }
}
```

- `role` and `members` still carry the normal binding meaning.
- `condition.title` and `condition.description` help reviewers understand why the binding exists.
- `expression` is the rule that must evaluate to true before the role applies.

Conditions are useful, yet they do not replace clean role choice and clean scope choice. A conditional project-level grant can still be too broad if the expression is wrong or the service does not expose the attribute you expected. Use the narrow resource scope first, then add conditions for jobs that need time, tag, or resource-name limits.

A condition only refines the binding that contains it. If Alice already receives the same permission through an unconditional project role, adding a temporary conditional binding does not cancel the older path. Effective access may come from another role, group membership, or ancestor grant, so a reviewer must evaluate all applicable relationships.

Modern IAM also has limiting policies. A **deny policy** can block selected permissions even when an allow role would otherwise grant them, such as preventing production project deletion except for a break-glass principal. A **Principal Access Boundary** restricts which resources a principal is eligible to access; it does not grant a role by itself. The complete decision therefore considers resource eligibility, explicit deny, applicable allow grants, and conditions.

The secure default remains simple: if no applicable role proves the required permission, the request is denied. An explicit deny is useful when a guardrail must win despite allow grants elsewhere. A missing grant and an explicit deny can produce the same user-visible refusal while requiring different investigation and remediation.

## How Should AWS Readers Translate the IAM Vocabulary?
<!-- section-summary: GCP IAM uses familiar access-control pieces, with different names and inheritance behavior than AWS. -->

AWS readers can map the main pieces without forcing them into a one-to-one service match. A GCP principal is the caller, similar to an AWS IAM principal. A GCP permission is close to an AWS action. A GCP resource is the target of the API request. A GCP role is a bundle of permissions, while AWS policies often list actions and resources directly inside policy documents.

The largest habit difference is hierarchy. In Google Cloud, allow policies can attach to organizations, folders, projects, and many service resources, then inherit downward. AWS also has organization-level controls such as SCPs, yet day-to-day IAM identity policies and resource policies are shaped differently. In GCP, checking parent folders and projects is a normal part of understanding effective access.

Service account identity also differs from the AWS workload-role pattern. In Google Cloud, a service account is an IAM principal that can receive roles, and it is also a resource with its own IAM policy that controls who can attach or impersonate it. In AWS, workloads often receive credentials by assuming an IAM role through STS. The security goal is similar: give software short-lived, scoped credentials. The operational model and policy surfaces are different.

## How Do You Debug a Denied Request and Apply Least Privilege?
<!-- section-summary: Denied request debugging follows principal, resource, permission, role, policy, binding, hierarchy, and condition in order. -->

Suppose the checkout API returns `403 PERMISSION_DENIED` while trying to read `orders/42.json` from `orders-prod`. The useful path is the same access question from the opening section.

First, confirm the principal. The Cloud Run service should run as `checkout-api@acme-prod.iam.gserviceaccount.com`. If the service runs as the default Compute Engine service account, your policy change may target the wrong caller.

Second, confirm the resource. The failed request targets the bucket `orders-prod` and a specific object name. A binding on a different bucket, a staging project, or a parent folder that excludes this project will not help the request.

Third, confirm the permission and role. Object retrieval needs `storage.objects.get` in an applicable role. A role that only lists bucket metadata can show the bucket while still failing to read its objects.

Fourth, inspect the effective policy path. Look for a binding on the bucket, project, folder, or organization that names the runtime service account and the right role. If a binding has a condition, check the time, resource, and attribute values that the condition expects.

Policy Troubleshooter can turn that checklist into a focused access check. Use the full resource name, the runtime service account, and the exact permission that failed:

```bash
gcloud policy-intelligence troubleshoot-policy iam \
  //storage.googleapis.com/projects/_/buckets/orders-prod \
  --principal-email=checkout-api@acme-prod.iam.gserviceaccount.com \
  --permission=storage.objects.get \
  --format=yaml
```

A shortened denied result might look like this:

```yaml
access: DENIED
explainedPolicies:
- fullResourceName: //storage.googleapis.com/projects/_/buckets/orders-prod
  bindingExplanations:
  - role: roles/storage.legacyBucketReader
    rolePermission: NOT_INCLUDED
    memberships:
      serviceAccount:checkout-api@acme-prod.iam.gserviceaccount.com: INCLUDED
```

- `access: DENIED` confirms the request still lacks the permission.
- `rolePermission: NOT_INCLUDED` means the matched role does not contain `storage.objects.get`; membership alone therefore cannot authorize this read.
- If the output shows `UNKNOWN`, the troubleshooter may lack permission to inspect a parent policy, group membership, custom role, deny policy, or principal access boundary that affects the result.

Audit logs help tie the check back to the real failed call. Search the same principal and time window before adding any broad grant:

```bash
gcloud logging read \
  'protoPayload.authenticationInfo.principalEmail="checkout-api@acme-prod.iam.gserviceaccount.com"
   protoPayload.status.code=7
   protoPayload.resourceName:"orders-prod"
   timestamp >= "2026-07-04T10:00:00Z"
   timestamp <= "2026-07-04T10:20:00Z"' \
  --project=acme-prod \
  --limit=5 \
  --format='table(timestamp,protoPayload.serviceName,protoPayload.methodName,protoPayload.status.message)'
```

```console
TIMESTAMP                 SERVICE_NAME            METHOD_NAME             STATUS_MESSAGE
2026-07-04T10:08:31Z      storage.googleapis.com  storage.objects.get  Permission 'storage.objects.get' denied on resource
```

- The principal in the log should match the Cloud Run runtime service account.
- The method should match the permission you tested.
- The resource should point at the bucket or object path you expected, not a staging bucket or a different project.

Google Cloud has tools such as Policy Troubleshooter, Policy Analyzer, and Cloud Audit Logs to support this investigation. The human habit still matters: write down the caller, action, target resource, expected role, actual binding scope, any condition, and the evidence source before changing access. That keeps a small bucket-read failure from turning into a broad project-level grant.

If IAM shows a valid allow path and the request still fails, do not assume another role is the answer. Authentication, organization constraints, VPC Service Controls, service-specific security, network reachability, and application authorization can refuse requests at other layers. IAM evidence narrows the failure domain; it does not erase those separate controls.

Least privilege has three dimensions. Choose the right principal, such as `checkout-api` rather than every authenticated user. Choose a role containing the minimum necessary permissions, such as object read rather than Storage administration. Grant it on the smallest practical scope, such as `orders-prod` rather than the organization, and add an appropriate condition only after those first three choices are sound.

Design durable human access around a job rather than one person's name. Define the production-log-investigation capabilities, grant them to a stable observer group, and manage Alice's current responsibility through group membership. IAM is ultimately a graph: a principal belongs to groups, groups and principals appear in bindings, bindings attach roles to resource scopes, roles contain permissions, and hierarchy propagates grants. A denied request often means one of those edges points at the wrong principal, role, resource, scope, condition, deny policy, or boundary.

## Check Your Answers

:::expand[What Question Does GCP IAM Answer?]{kind="recap"}
After authentication establishes identity, IAM asks whether this principal may use this permission on this resource under the current policy context.
:::

:::expand[Who Is the Principal on the Request?]{kind="recap"}
The principal is the actual authenticated human, group-derived identity, service account, or federated workload on the request. It may differ from the person who deployed the code.
:::

:::expand[Which Resource and Permission Does the Request Use?]{kind="recap"}
The resource is the exact target and the permission is the smallest checked API action. Both are required to state the authorization question precisely.
:::

:::expand[How Do Roles Bundle Permissions for a Job?]{kind="recap"}
A role is a named permission bundle. Predefined roles are Google-maintained, custom roles are organization-maintained, and broad basic roles weaken production least privilege.
:::

:::expand[How Do Allow Policies, Bindings, and Inheritance Create a Grant?]{kind="recap"}
An allow policy lives on a resource; a binding connects principals to a role there; ancestor bindings add inherited access to the effective policy.
:::

:::expand[How Do Conditions, Deny Policies, and Boundaries Limit Access?]{kind="recap"}
Conditions refine one grant, deny policies can block allowed permissions, and principal access boundaries restrict eligible resource space without granting access.
:::

:::expand[How Should AWS Readers Translate the IAM Vocabulary?]{kind="recap"}
A GCP IAM role is a permission bundle, while a GCP service account is the closer workload-identity analogue to an assumable AWS IAM role.
:::

:::expand[How Do You Debug a Denied Request and Apply Least Privilege?]{kind="recap"}
Trace principal, full resource, permission, effective grants, conditions, deny policies, boundaries, and request evidence; then grant the narrowest job-shaped role at the smallest scope.
:::

## References

- [IAM overview](https://docs.cloud.google.com/iam/docs/overview) - Defines the main IAM access question and the relationship between principals, roles, and resources.
- [IAM principals](https://docs.cloud.google.com/iam/docs/principals-overview) - Lists the principal types that can appear in Google Cloud allow policies.
- [Roles and permissions](https://docs.cloud.google.com/iam/docs/roles-overview) - Explains permissions, predefined roles, custom roles, and basic roles.
- [Understanding allow policies](https://docs.cloud.google.com/iam/docs/allow-policies) - Documents allow-policy structure, bindings, members, etags, and conditional bindings.
- [Using resource hierarchy for access control](https://docs.cloud.google.com/iam/docs/resource-hierarchy-access-control) - Explains IAM inheritance through organizations, folders, projects, and resources.
- [Overview of IAM Conditions](https://docs.cloud.google.com/iam/docs/conditions-overview) - Documents conditional, attribute-based access control for Google Cloud resources.
- [Troubleshoot IAM permissions](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) - Documents Policy Troubleshooter inputs, output, and audit-log troubleshooting flow.
