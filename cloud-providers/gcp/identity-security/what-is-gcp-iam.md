---
title: "What Is GCP IAM"
description: "Understand how Google Cloud IAM checks callers, permissions, resources, roles, allow policies, bindings, hierarchy, and conditions."
overview: "GCP IAM answers a plain access question for every request: who is calling, what are they trying to do, and which resource are they touching. The examples follow a photo uploader service that writes to one bucket and a support analyst who needs read-only log access."
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

1. [The Access Question](#the-access-question)
2. [Principal: Who Is Calling](#principal-who-is-calling)
3. [Resource: What Is Being Touched](#resource-what-is-being-touched)
4. [Permission: The Exact Action](#permission-the-exact-action)
5. [Role: A Bundle of Permissions](#role-a-bundle-of-permissions)
6. [Allow Policy: Where Grants Are Stored](#allow-policy-where-grants-are-stored)
7. [Binding: The Link Between Principal and Role](#binding-the-link-between-principal-and-role)
8. [Hierarchy: Where Access Inherits](#hierarchy-where-access-inherits)
9. [Condition: Extra Rules on a Binding](#condition-extra-rules-on-a-binding)
10. [How AWS Readers Can Map the Ideas](#how-aws-readers-can-map-the-ideas)
11. [Debugging One Denied Request](#debugging-one-denied-request)
12. [References](#references)

## The Access Question
<!-- section-summary: GCP IAM answers who is calling, what action they want, and which resource the request touches. -->

Google Cloud IAM is the access-control system that decides whether a caller may use a Google Cloud API on a Google Cloud resource. The plain version of the question is direct: **who is calling, what are they trying to do, and which resource are they touching?** Every IAM topic in this module fits somewhere inside that question.

Picture a small product team that runs a photo-sharing app. A Cloud Run service named `photo-uploader` receives image uploads and writes objects into one Cloud Storage bucket named `prod-photo-uploads`. A support analyst named Priya sometimes investigates customer tickets by reading application logs for the same service.

The beginner version is like access at a workplace. A person or service presents an identity, asks to do a task, and touches a specific room or file. The decision is different for "Priya may view application logs" and "the upload service may create photo objects." IAM turns those plain access sentences into policies Google Cloud can evaluate on every API request.

That is why IAM is not only a security team topic. Every production service uses it. The runtime identity of a Cloud Run service, the deploy identity in CI, the analyst opening logs, and the automation rotating secrets all produce IAM decisions. If the article teaches only role names, the reader still cannot debug the denied request. The access question gives the debugging shape.

Those two jobs need different access. The uploader service should create objects in one bucket, and it should not administer the whole project. Priya should read logs, and she should not read secret payloads or change runtime settings. IAM lets you describe those jobs as principals, resources, permissions, roles, policies, bindings, hierarchy, and conditions.

![IAM request path](/content-assets/articles/article-cloud-providers-gcp-identity-security-gcp-identity-security-mental-model/iam-request-path.png)
*An IAM decision follows the request: caller, action, target resource, applicable grants, and any extra rules on those grants.*

## Principal: Who Is Calling
<!-- section-summary: A principal is the identity that Google Cloud sees on the request. -->

A **principal** is the authenticated identity that makes a request. A principal can be a human user, a Google group, a service account, a domain, or a federated identity from another identity provider. IAM decisions always need the actual principal on the request, because two callers can run the same command and receive different results.

Think of a principal as the name on the request envelope. Google Cloud does not decide access from the laptop, browser, or container alone. It decides from the authenticated identity attached to the API call. That identity might be Priya signing in as a human, a Cloud Run service account writing an object, or a CI/CD service account deploying a new revision.

This is why "the app has access" is too vague. Which app identity? The service account attached to Cloud Run? The CI account that deployed it? A human who tested the command locally? A clear access review names the exact principal because audit logs and IAM policies use that identity.

For the photo app, the runtime principal is the service account attached to Cloud Run:

`serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com`

Priya's human identity is a different principal:

`user:priya@example.com`

Groups help manage human access. Instead of granting log access to each analyst one by one, the team can grant a role to `group:support-analysts@example.com` and manage membership through the company identity process. For software, dedicated service accounts keep workload access separate from human access and make audit logs easier to read.

## Resource: What Is Being Touched
<!-- section-summary: A resource is the Google Cloud object the request wants to read, change, create, or delete. -->

A **resource** is the thing the request touches. It might be a project, folder, bucket, secret, log bucket, Pub/Sub topic, Cloud Run service, or one object inside a service. IAM needs the resource because access is not only about the caller. It is also about the target.

Use a building-access picture. A badge that opens one storage room is very different from a badge that opens the whole building. The person holding the badge may be the same, and the action may still be "open a door," but the target changes the risk. IAM works the same way. A role on one bucket is a narrow storage-room grant. A role on a project can reach many resources inside that project.

That is why resource scope is a beginner concept, not an advanced detail. If you grant access at the wrong resource level, the role may technically work while the security design is still wrong.

The uploader service needs the bucket:

`projects/_/buckets/prod-photo-uploads`

Priya needs logging resources in the production project:

`projects/media-prod`

Those targets should stay separate. Bucket write access belongs on the bucket for a workload that only writes photos there. Log viewing access belongs on the project or log view that covers the support workflow. If both callers receive broad project roles, the policy stops saying what each job actually needs.

## Permission: The Exact Action
<!-- section-summary: A permission is the smallest IAM action a Google Cloud API checks. -->

A **permission** is the exact API action required for an operation. It is the smallest action IAM checks, such as create an object, list log entries, update a service, or access a secret payload. You usually do not grant permissions one by one, yet the API check still happens at this level.

Think of a role as a job title and a permission as one task inside that job. "Storage object creator" is the job-shaped role. `storage.objects.create` is the exact task the Cloud Storage API needs for a new object write. During troubleshooting, the missing permission tells you the exact task that failed. During design, the role should still describe the job a human can review.

For photo uploads, Cloud Storage checks for an object-create permission. For Priya's log search, Cloud Logging checks for log-viewing permissions.

Here is the shape of the two jobs:

| Job | Resource | Permission idea |
|---|---|---|
| Photo uploader writes images | Bucket `prod-photo-uploads` | Create objects in the bucket. |
| Support analyst reads logs | Project or log view for `media-prod` | View log entries and related metadata. |

Permission names often look service-shaped, such as `storage.objects.create` or `logging.logEntries.list`. That naming is useful during troubleshooting because an error message may say which permission was missing. The fix should still grant a job-shaped role at the narrowest useful scope instead of handing out a broad admin role.

## Role: A Bundle of Permissions
<!-- section-summary: A role packages permissions into a named access bundle that can be granted to a principal. -->

A **role** is a named bundle of permissions. Google Cloud provides predefined roles for common jobs, such as object creation in Cloud Storage or viewing logs in Cloud Logging. Your organization can also create custom roles if predefined roles grant more than the job needs.

The uploader service can use `roles/storage.objectCreator` on the `prod-photo-uploads` bucket. That role is a good fit for upload-only services because it allows object creation without handing the service a normal file-browser style role across the whole project.

Priya can use a logging viewer role that fits the support process. If the support team only needs application logs, a narrower log view plus a viewer role can reduce exposure compared with project-wide broad access. The key habit is to describe the job first, then pick the smallest role and scope that covers that job.

Basic roles such as Owner, Editor, and Viewer are too broad for most production work. They may appear in old projects or early experiments, yet they hide the real access story. A production service named `photo-uploader` should not need a role that can edit unrelated services, buckets, secrets, networks, and IAM policies.

## Allow Policy: Where Grants Are Stored
<!-- section-summary: An allow policy is attached to a resource and stores the role grants for that resource. -->

An **allow policy** is the IAM policy attached to a Google Cloud resource. The policy contains metadata and one or more bindings. Google Cloud evaluates the policies attached to the target resource and its parents to decide whether a principal has a role that includes the required permission.

For the uploader service, the strongest first shape is a policy on the bucket. That policy can say that only the uploader service account receives object-create access on `prod-photo-uploads`. A project-level policy would reach more resources, so it needs a stronger reason.

The policy document itself is not the whole story. Its attachment point matters just as much as its contents. The same binding on one bucket is narrow. The same binding on a project can cover many buckets. The same binding on a folder can cover many projects.

Compare the same grant in two places. The narrow version lives on the bucket policy:

```yaml
resource: //storage.googleapis.com/projects/_/buckets/prod-photo-uploads
bindings:
- role: roles/storage.objectCreator
  members:
  - serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com
```

The broader version lives on the project policy:

```yaml
resource: //cloudresourcemanager.googleapis.com/projects/media-prod
bindings:
- role: roles/storage.objectCreator
  members:
  - serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com
```

The member and role stay the same. The attachment point changes the blast radius. The bucket policy lets `photo-uploader` create objects in `prod-photo-uploads`. The project policy can apply to Cloud Storage buckets in `media-prod` where that role is honored through project-level IAM, including future buckets unless another control blocks the request.

A quick review should check both places:

```bash
gcloud storage buckets get-iam-policy gs://prod-photo-uploads \
  --format='table(bindings.role,bindings.members)'

gcloud projects get-iam-policy media-prod \
  --flatten='bindings[].members' \
  --filter='bindings.members:photo-uploader@media-prod.iam.gserviceaccount.com' \
  --format='table(bindings.role,bindings.members)'
```

- The bucket command should show the object-creator role on the bucket that needs writes.
- The project command should return nothing for that same Storage writer grant unless the team has approved project-wide bucket access.
- If the project command shows the role, the reviewer should ask which other buckets the uploader can touch and why the grant belongs at project scope.

## Binding: The Link Between Principal and Role
<!-- section-summary: A binding connects a principal to a role, optionally with a condition. -->

A **binding** is the part of an allow policy that connects one or more principals to one role. Older IAM output often calls principals `members`, so you may see `members` in JSON and YAML policy results.

The binding is the actual sentence inside the policy: this principal gets this role here. The role by itself grants nothing. The principal by itself grants nothing. The resource policy by itself is only a document. The binding links them together so Google Cloud can answer the request.

For beginners, this is the point where IAM stops being abstract. You can point at one binding and ask: who receives access, what role did they receive, and which resource stores the grant? If any of those three pieces are broader than the job, the access design needs review.

The uploader bucket binding can be created with the Google Cloud CLI after the service account and bucket already exist:

```bash
gcloud storage buckets add-iam-policy-binding gs://prod-photo-uploads \
  --member="serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

- `gs://prod-photo-uploads` is the resource receiving the allow-policy change.
- `--member` names the workload principal that will call Cloud Storage.
- `--role` grants a predefined role that includes object creation without broad project administration.

A healthy result should show a binding like this:

```yaml
bindings:
- members:
  - serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com
  role: roles/storage.objectCreator
etag: BwYh2mQ9cJ0=
```

- The role and member appear together, which means the policy now has the binding.
- The `etag` protects policy updates from accidental overwrite by concurrent changes.
- The output should name the service account that actually runs the Cloud Run service, not the human who deployed it.

## Hierarchy: Where Access Inherits
<!-- section-summary: Google Cloud resources sit in a hierarchy, and allow policies can inherit from parent resources to children. -->

The **resource hierarchy** is the parent-child structure that organizes Google Cloud resources. An organization can contain folders, folders can contain projects, and projects contain service resources such as buckets, secrets, topics, services, and log buckets.

Allow policies inherit downward. A role granted on an organization can affect folders and projects below it. A role granted on a production folder can affect every production project inside that folder. A role granted directly on a bucket affects that bucket without granting the same access to every bucket in the project.

![IAM grant scope map](/content-assets/articles/article-cloud-providers-gcp-identity-security-gcp-identity-security-mental-model/iam-grant-scope-map.png)
*The same role can have a different blast radius depending on whether it lives on a bucket, project, folder, or organization.*

For the photo app, inheritance is the reason the bucket-level binding is safer than a project-level grant. The service account only needs to create objects in `prod-photo-uploads`. A project-level Storage role might cover other buckets, including private exports or security evidence that the uploader should never touch.

Priya's log access may need a wider scope because support investigations often cross several Cloud Run revisions and log streams inside one project. Even then, the team should decide whether the access belongs on the project, a log view, or a support group rather than granting unrelated roles directly to one user.

## Condition: Extra Rules on a Binding
<!-- section-summary: An IAM Condition adds a context expression that must pass before a binding grants access. -->

An **IAM Condition** is an extra rule on a binding. The binding still has a principal, role, and scope, and the condition controls whether that binding applies. Conditions can use attributes such as request time, resource name, resource type, and resource tags if the target service supports conditional role bindings.

Think of a condition as a checked note attached to the grant. The policy still says the migration service account can create objects, and the condition adds a rule such as "only before this approved end time." This is useful for temporary access, migration access, and tightly scoped operational windows.

Conditions are powerful because they let a reviewed grant carry more context than principal plus role. They are also easy to over-trust. A condition on a broad project role can still create too much access if the expression misses the real resource boundary. The safer order is: choose a narrow resource, choose the smallest useful role, then add a condition for time, resource name, or tag constraints.

Imagine the photo platform has an approved migration that allows a temporary service account to write test images into the production upload bucket. A condition can limit the binding to a short time window and to object resources under the intended bucket path.

```json
{
  "role": "roles/storage.objectCreator",
  "members": [
    "serviceAccount:photo-migration@media-prod.iam.gserviceaccount.com"
  ],
  "condition": {
    "title": "PhotoMigrationWindow",
    "description": "Temporary object creation for the approved photo migration window.",
    "expression": "request.time < timestamp(\"2026-07-06T08:00:00Z\")"
  }
}
```

- `role` and `members` still carry the normal binding meaning.
- `condition.title` and `condition.description` help reviewers understand why the binding exists.
- `expression` is the rule that must evaluate to true before the role applies.

Conditions are useful, yet they do not replace clean role choice and clean scope choice. A conditional project-level grant can still be too broad if the expression is wrong or the service does not expose the attribute you expected. Use the narrow resource scope first, then add conditions for jobs that need time, tag, or resource-name limits.

## How AWS Readers Can Map the Ideas
<!-- section-summary: GCP IAM uses familiar access-control pieces, with different names and inheritance behavior than AWS. -->

AWS readers can map the main pieces without forcing them into a one-to-one service match. A GCP principal is the caller, similar to an AWS IAM principal. A GCP permission is close to an AWS action. A GCP resource is the target of the API request. A GCP role is a bundle of permissions, while AWS policies often list actions and resources directly inside policy documents.

The largest habit difference is hierarchy. In Google Cloud, allow policies can attach to organizations, folders, projects, and many service resources, then inherit downward. AWS also has organization-level controls such as SCPs, yet day-to-day IAM identity policies and resource policies are shaped differently. In GCP, checking parent folders and projects is a normal part of understanding effective access.

Service account identity also differs from the AWS workload-role pattern. In Google Cloud, a service account is an IAM principal that can receive roles, and it is also a resource with its own IAM policy that controls who can attach or impersonate it. In AWS, workloads often receive credentials by assuming an IAM role through STS. The security goal is similar: give software short-lived, scoped credentials. The operational model and policy surfaces are different.

## Debugging One Denied Request
<!-- section-summary: Denied request debugging follows principal, resource, permission, role, policy, binding, hierarchy, and condition in order. -->

Suppose the photo uploader returns `403 PERMISSION_DENIED` while trying to save `customers/8842/profile.jpg` into `prod-photo-uploads`. The useful path is the same access question from the opening section.

First, confirm the principal. The Cloud Run service should run as `photo-uploader@media-prod.iam.gserviceaccount.com`. If the service runs as the default Compute Engine service account, your policy change may target the wrong caller.

Second, confirm the resource. The failed request targets the bucket `prod-photo-uploads` and a specific object name. A binding on a different bucket, a staging project, or a parent folder that excludes this project will not help the request.

Third, confirm the permission and role. Object creation needs a role that contains the object-create permission. A metadata viewer role can show bucket details while still failing on object creation.

Fourth, inspect the effective policy path. Look for a binding on the bucket, project, folder, or organization that names the runtime service account and the right role. If a binding has a condition, check the time, resource, and attribute values that the condition expects.

Policy Troubleshooter can turn that checklist into a focused access check. Use the full resource name, the runtime service account, and the exact permission that failed:

```bash
gcloud policy-intelligence troubleshoot-policy iam \
  //storage.googleapis.com/projects/_/buckets/prod-photo-uploads \
  --principal-email=photo-uploader@media-prod.iam.gserviceaccount.com \
  --permission=storage.objects.create \
  --format=yaml
```

A shortened denied result might look like this:

```yaml
access: DENIED
explainedPolicies:
- fullResourceName: //storage.googleapis.com/projects/_/buckets/prod-photo-uploads
  bindingExplanations:
  - role: roles/storage.objectViewer
    rolePermission: NOT_INCLUDED
    memberships:
      serviceAccount:photo-uploader@media-prod.iam.gserviceaccount.com: INCLUDED
```

- `access: DENIED` confirms the request still lacks the permission.
- `rolePermission: NOT_INCLUDED` means the matched role does not contain `storage.objects.create`.
- If the output shows `UNKNOWN`, the troubleshooter may lack permission to inspect a parent policy, group membership, custom role, deny policy, or principal access boundary that affects the result.

Audit logs help tie the check back to the real failed call. Search the same principal and time window before adding any broad grant:

```bash
gcloud logging read \
  'protoPayload.authenticationInfo.principalEmail="photo-uploader@media-prod.iam.gserviceaccount.com"
   protoPayload.status.code=7
   protoPayload.resourceName:"prod-photo-uploads"
   timestamp >= "2026-07-04T10:00:00Z"
   timestamp <= "2026-07-04T10:20:00Z"' \
  --project=media-prod \
  --limit=5 \
  --format='table(timestamp,protoPayload.serviceName,protoPayload.methodName,protoPayload.status.message)'
```

```console
TIMESTAMP                 SERVICE_NAME            METHOD_NAME             STATUS_MESSAGE
2026-07-04T10:08:31Z      storage.googleapis.com  storage.objects.create  Permission 'storage.objects.create' denied on resource
```

- The principal in the log should match the Cloud Run runtime service account.
- The method should match the permission you tested.
- The resource should point at the bucket or object path you expected, not a staging bucket or a different project.

![IAM debug evidence board](/content-assets/articles/article-cloud-providers-gcp-identity-security-gcp-identity-security-mental-model/iam-debug-evidence-board.png)
*A useful access investigation keeps caller, target, permission, role, binding, scope, condition, and evidence in one place.*

Google Cloud has tools such as Policy Troubleshooter, Policy Analyzer, and Cloud Audit Logs to support this investigation. The human habit still matters: write down the caller, action, target resource, expected role, actual binding scope, any condition, and the evidence source before changing access. That keeps a small bucket-writing failure from turning into a broad project-level grant.

## References

- [IAM overview](https://docs.cloud.google.com/iam/docs/overview) - Defines the main IAM access question and the relationship between principals, roles, and resources.
- [IAM principals](https://docs.cloud.google.com/iam/docs/principals-overview) - Lists the principal types that can appear in Google Cloud allow policies.
- [Roles and permissions](https://docs.cloud.google.com/iam/docs/roles-overview) - Explains permissions, predefined roles, custom roles, and basic roles.
- [Understanding allow policies](https://docs.cloud.google.com/iam/docs/allow-policies) - Documents allow-policy structure, bindings, members, etags, and conditional bindings.
- [Using resource hierarchy for access control](https://docs.cloud.google.com/iam/docs/resource-hierarchy-access-control) - Explains IAM inheritance through organizations, folders, projects, and resources.
- [Overview of IAM Conditions](https://docs.cloud.google.com/iam/docs/conditions-overview) - Documents conditional, attribute-based access control for Google Cloud resources.
- [Troubleshoot IAM permissions](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) - Documents Policy Troubleshooter inputs, output, and audit-log troubleshooting flow.
