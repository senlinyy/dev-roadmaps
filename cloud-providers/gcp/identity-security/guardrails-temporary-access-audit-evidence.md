---
title: "Guardrails, Temporary Access, and Audit Evidence"
description: "Use GCP IAM guardrails, just-in-time production access, Cloud Audit Logs, and Terraform review habits to keep sensitive access narrow and explainable."
overview: "This final GCP identity and security article follows a checkout production incident through folder-level review, deny policies, principal access boundaries, IAM Recommender, Privileged Access Manager, Cloud Audit Logs, break-glass access, and Terraform review habits."
tags: ["gcp", "iam", "guardrails", "audit"]
order: 4
id: article-cloud-providers-gcp-identity-security-guardrails-temporary-access-audit-evidence
aliases:
  - guardrails-temporary-access-audit-evidence
  - temporary-access-and-audit-evidence
  - iam-guardrails-and-audit-evidence
  - gcp-iam-guardrails-temporary-access-audit-evidence
  - cloud-providers/gcp/identity-security/guardrails-temporary-access-audit-evidence.md
---

## Table of Contents

1. [The Production Access Problem](#the-production-access-problem)
2. [Review Access at Organization and Folder Level](#review-access-at-organization-and-folder-level)
3. [Deny Policies for Hard Guardrails](#deny-policies-for-hard-guardrails)
4. [Principal Access Boundary Policies](#principal-access-boundary-policies)
5. [IAM Recommender for Excessive Permissions](#iam-recommender-for-excessive-permissions)
6. [Privileged Access Manager for Temporary Access](#privileged-access-manager-for-temporary-access)
7. [Cloud Audit Logs as Evidence](#cloud-audit-logs-as-evidence)
8. [Break-Glass Access](#break-glass-access)
9. [Terraform Review Habits for IAM Changes](#terraform-review-habits-for-iam-changes)
10. [Access Review Cadence](#access-review-cadence)
11. [Putting It All Together](#putting-it-all-together)

## The Production Access Problem
<!-- section-summary: Production access should answer why access is needed, who approved it, how long it lasts, and what evidence proves what happened. -->

The earlier articles in this module covered the main access building blocks. IAM explains how Google Cloud connects a **principal**, a **role**, and a **resource scope**. Service accounts explain how applications and automation get their own identity. Secret Manager explains how sensitive runtime values stay behind an API boundary with IAM and audit logging.

This article picks up the part that usually shows up during real operations: someone needs production access during pressure. A checkout service starts failing after a payment provider change. Customers can browse the store, add items to a cart, and reach the payment page, but every fifth payment attempt returns a generic error. The on-call developer, Maya, needs to inspect production logs and Cloud Run revision details for the `checkout-prod` project.

The risky answer would be to add Maya to a broad production admin group and promise to remove the access later. That kind of access sticks around after the incident, and the next access review has to guess why it exists. The safer answer records the reason up front, grants only the roles needed for the investigation, gives the access a fixed end time, and leaves audit evidence showing what Maya actually did.

So the structure for the rest of the article is simple. First, we look at inherited access across the organization and folders, because production access often comes from a parent scope. Then we add guardrails that block dangerous actions. After that, we use recommendations to find roles that are too broad, use Privileged Access Manager for short-lived elevation, and read Cloud Audit Logs as the evidence trail. Finally, we keep break-glass and Terraform review habits clear, because those are the places where emergency access can quietly turn into permanent access.

## Review Access at Organization and Folder Level
<!-- section-summary: Parent-scope IAM grants flow down into projects, so production reviews need to start above the project. -->

Google Cloud resources live in a **resource hierarchy**. At the top, an organization represents the company. Under that, folders usually group environments, teams, business units, or platforms. Projects sit under folders and hold most of the actual resources, such as Cloud Run services, Secret Manager secrets, logs, buckets, and databases.

IAM access inherits down that hierarchy. If a group receives `roles/viewer` on the `Production` folder, that group receives viewer permissions across the projects inside that folder. If a platform admin group receives `roles/resourcemanager.projectIamAdmin` at the organization level, that group can affect IAM across many folders and projects. The project page alone can miss the access that came from above it.

In the checkout incident, the first review question should focus on existing inherited access: "Which groups already have production visibility because of organization or folder grants?" A production folder might already grant `roles/logging.viewer` to `group:prod-readers@example.com`. If Maya belongs to that group, the team might only need temporary access to one additional role, or the team might discover that baseline visibility already covers the investigation.

An access review at parent scopes usually looks for a few patterns:

| Scope | Review Question | Production Risk |
|---|---|---|
| **Organization** | Which groups can change IAM, billing, projects, folders, or organization policy across the company? | One broad role can affect every environment. |
| **Production folder** | Which groups inherit access into every production project? | A convenience group can quietly turn into company-wide production access. |
| **Team folder** | Which team groups can administer projects outside their normal service area? | A service team can accidentally reach another team's data. |
| **Project** | Which direct bindings grant access that parent scopes already grant? | Repeated bindings make reviews noisy and hide the real source of access. |

![Production access guardrails](/content-assets/articles/article-cloud-providers-gcp-identity-security-guardrails-temporary-access-audit-evidence/production-access-guardrails.png)
*Production access review works best when the team can see the requester, role, scope, duration, guardrails, and evidence path together before access is granted.*

For a beginner, the important part is the direction of inheritance. A role granted on a parent helps the principal work on descendants. A role granted on a child stays local to that child. When a role looks surprising in a production project, the source might be the project policy, the folder policy, or the organization policy.

In mature environments, access reviews start with the broadest scopes. Security and platform teams review organization-level and production-folder grants before they review individual projects. Product teams still review their own project-level access, but they do that after the parent-scope picture is clear. That order prevents a project owner from removing a direct binding while a wider inherited binding still grants the same access.

## Deny Policies for Hard Guardrails
<!-- section-summary: Deny policies block selected permissions even when an allow policy grants a broad role somewhere else. -->

An **IAM deny policy** is a policy that blocks principals from using specific supported permissions. It attaches to an organization, folder, or project, and it inherits downward like allow policies. Deny policies are useful when a team wants to place a hard line around dangerous actions, especially actions that should remain rare even for people with broad roles.

In normal IAM, an allow policy grants a role, and that role contains permissions. A deny policy adds another layer to the decision. If the deny rule matches the principal and permission, the request is blocked even when an allow binding grants a role that contains that permission. This gives platform and security teams a way to protect the organization from high-impact operations.

Here is a practical production example. The checkout team uses many projects under the `Production` folder. Product engineers can deploy services and inspect logs through narrow roles, and a smaller platform group can manage project configuration. The security team adds a deny policy at the production folder that blocks project deletion for almost everyone, with an exception for a tightly controlled project-admin group.

That policy matters during an incident. If someone quickly grants a broad role to help debug checkout failures, the deny policy still blocks the protected action. The team can move fast on log inspection and service diagnosis while the folder-level guardrail continues to protect project deletion.

Deny policies work best for actions where the organization can write a simple rule. Examples include blocking deletion of production projects, blocking removal of critical logging sinks, or blocking service account key creation in sensitive folders when the organization has moved to keyless workload identity. The exact permissions must be supported by IAM deny policies, so teams normally test the rule with Policy Simulator or a non-production folder before they apply it widely.

A useful review question sounds like this: "Which actions should stay blocked even if someone accidentally receives a broad role?" That question leads to guardrails. It also keeps deny policies from turning into a giant second permission system. The goal is a small set of high-value blocks that protect production from mistakes, rushed incident changes, and stale broad roles.

## Principal Access Boundary Policies
<!-- section-summary: Principal access boundaries limit the resource area where selected principals can use supported IAM permissions. -->

A **principal access boundary policy** controls which resources a principal is eligible to access. The allow policy still grants the actual role. The boundary limits where that granted access can be useful, based on the resources included in the boundary rules. Google Cloud applies these policies to principal sets, such as a set of workforce or workload identities.

That distinction matters. A deny policy usually blocks selected permissions for selected principals. A principal access boundary keeps selected principals inside approved resource areas for supported permissions. The first shape is permission-centered. The second shape is location-centered.

In a company with many folders, this helps separate teams that share a central identity system. A checkout developer group might be eligible to access resources only under the `Checkout` folder and a shared observability project. A data platform group might be eligible to access resources only under the `Data Platform` folder. Even if a role binding appears in the wrong place, the boundary helps keep the principal inside the intended part of the hierarchy for permissions that the boundary can enforce.

For the checkout incident, principal access boundaries are helpful before the incident starts. Maya belongs to `group:checkout-engineers@example.com`. That group can request production debugging access, but the boundary keeps the eligible resource area focused on checkout-owned projects and shared logging infrastructure. The boundary gives security reviewers confidence that a temporary grant for checkout debugging stays inside the checkout production area.

In production design, a principal access boundary policy usually has three parts:

| Part | Plain Meaning | Checkout Example |
|---|---|---|
| **Policy rules** | The resources the principal set can access. | Checkout production projects and shared logging projects. |
| **Policy binding** | The principal set the boundary applies to. | Checkout engineer workforce group. |
| **Optional condition** | A filter that narrows which principals in the set receive the boundary. | Apply to service accounts, or exclude a specific security automation identity. |

Principal access boundaries need careful review because multiple boundaries can interact. The team should treat them as organization-level security design rather than a quick incident fix. They are most useful when the hierarchy already separates environments and ownership clearly, because the boundary can point at the folder or project areas that match real responsibility.

## IAM Recommender for Excessive Permissions
<!-- section-summary: IAM Recommender turns permission usage data into suggestions for removing or replacing broad role grants. -->

**IAM Recommender** helps find principals with excessive permissions. It reviews IAM access data and looks at permissions a principal used during the observation period, up to the most recent 90 days. Then it can recommend removing a role or replacing it with one or more narrower roles when the current grant looks broader than the observed need.

This is useful because access reviews can get very human very quickly. A reviewer sees `roles/editor` on a service account and asks the owning team if it is needed. The owning team says the service is important and nobody wants to break checkout. Without evidence, the review gets stuck between security risk and outage fear.

IAM Recommender gives the conversation a better starting point. It might show that a deployment service account left most permissions in a broad role unused during the observation period. It might suggest replacing a basic role with specific Cloud Run, Artifact Registry, and Logging roles. It can also surface lateral movement insights, especially when service accounts can impersonate other service accounts across projects.

During the checkout incident, Recommender supports cleanup around the incident while PAM handles the temporary grant. If the team discovers that `group:checkout-engineers@example.com` already had permanent `roles/editor` on the production project, the incident should create a follow-up item. The team can use role recommendations and policy insights to replace the permanent broad role with normal read access plus PAM entitlements for rare elevation.

A practical review flow looks like this:

| Step | What the Reviewer Looks At | Decision |
|---|---|---|
| **Find broad roles** | Basic roles like Owner, Editor, Viewer, or wide predefined roles on production projects. | Prioritize the highest-risk grants. |
| **Open recommendation evidence** | Permission usage, suggested replacement roles, and any lateral movement insight. | Decide whether the recommendation matches real operations. |
| **Simulate or stage the change** | Policy Simulator, staging projects, or a planned rollout window. | Reduce outage risk before removing access. |
| **Apply and watch** | Terraform change, audit logs, alerts, and application health. | Confirm the role reduction worked. |

Recommender needs human review because recent usage never captures every business reason. A rare disaster recovery task might happen once a year. A service agent role might look strange but support a managed service. The best pattern is to use recommendations as evidence, add owner context, and then turn permanent broad access into narrow baseline access plus temporary elevation for rare tasks.

## Privileged Access Manager for Temporary Access
<!-- section-summary: Privileged Access Manager grants approved IAM roles for a fixed duration and removes them when the grant ends. -->

**Privileged Access Manager**, usually shortened to **PAM**, manages just-in-time elevated access. Instead of giving someone a powerful production role forever, the team creates an **entitlement**. An entitlement defines who can request access, which roles can be granted, which resource receives those roles, how long the grant can last, and who must approve it.

For the checkout incident, the entitlement might be named `checkout-prod-debugging`. It applies to the `checkout-prod` project. It allows eligible checkout on-call engineers to request `roles/logging.viewer` and `roles/run.viewer` for up to two hours. It requires a justification with the incident number, and it requires approval from the incident commander or production owner.

Here is the production flow in normal language. Maya opens a PAM request for two hours, selects the checkout debugging entitlement, writes `INC-4821 payment failures after provider timeout change`, and submits it. The approver sees the request, checks that the access matches the incident, and approves it. PAM adds the temporary role bindings to the project IAM policy. When the grant ends, PAM removes the bindings.

That flow gives the team several things at once. The access is tied to a reason. The approver is recorded. The roles are limited to the entitlement. The duration has an upper bound. The cleanup happens through the tool instead of relying on someone remembering to remove a manual IAM binding at the end of a long incident.

IAM Conditions can also express time-bounded access in allow policies. A conditional binding with `request.time < timestamp("...")` grants the role only until the timestamp. PAM is usually the stronger operational fit for recurring production elevation because it adds request, approval, grant lifecycle, notification, and audit behavior around the IAM binding. Conditional bindings are still useful as a fallback or for infrastructure-managed access windows.

Here is what a Terraform-managed conditional fallback can look like for a short incident grant:

```hcl
resource "google_project_iam_member" "checkout_incident_logs" {
  project = "checkout-prod"
  role    = "roles/logging.viewer"
  member  = "user:maya@example.com"

  condition {
    title       = "inc_4821_checkout_debug"
    description = "Temporary log access for checkout production incident INC-4821"
    expression  = "request.time < timestamp(\"2026-06-14T19:00:00Z\")"
  }
}
```

This Terraform resource is consumed by the Google provider during `terraform apply`, and it creates one IAM member binding on the `checkout-prod` project. The `project`, `role`, and `member` fields answer where the grant lives, what Maya receives, and which principal receives it. The `condition` block carries the incident title, reviewer-readable description, and time limit.

A reviewer should expect a plan like this before approving the fallback:

```hcl
# google_project_iam_member.checkout_incident_logs will be created
+ resource "google_project_iam_member" "checkout_incident_logs" {
    project = "checkout-prod"
    role    = "roles/logging.viewer"
    member  = "user:maya@example.com"

    condition {
      title       = "inc_4821_checkout_debug"
      description = "Temporary log access for checkout production incident INC-4821"
      expression  = "request.time < timestamp(\"2026-06-14T19:00:00Z\")"
    }
  }
```

The condition is the important part of this example. It makes the grant expire by time, and the title and description carry the incident evidence. If the team uses PAM for the same access, Terraform should avoid overwriting PAM-managed role bindings. Google specifically recommends using non-authoritative Terraform IAM resources when PAM also manages temporary role bindings, because authoritative resources can replace bindings that are outside Terraform state.

![Temporary access lifecycle](/content-assets/articles/article-cloud-providers-gcp-identity-security-guardrails-temporary-access-audit-evidence/temporary-access-lifecycle.png)
*Temporary access should have a lifecycle: request, approval, time-bounded grant, production investigation, automatic removal, and after-incident review.*

## Cloud Audit Logs as Evidence
<!-- section-summary: Cloud Audit Logs show who performed an action, what method ran, which resource was touched, and when it happened. -->

**Cloud Audit Logs** are Google Cloud's activity records for administrative actions, data access, system events, and policy denials. They help answer the production evidence questions: **who did what, where, and when**. For identity and security work, audit logs turn access from a promise into something a reviewer can inspect after the fact.

In the checkout incident, the evidence needs to cover both access changes and production actions. The team wants to know who approved Maya's temporary access, when the role binding appeared, which resources Maya viewed, and when the grant ended. The audit trail should also show whether anyone changed IAM manually during the incident.

Cloud Audit Logs have several categories that matter here:

| Log Type | What It Shows | Checkout Example |
|---|---|---|
| **Admin Activity** | User-driven changes to configuration or metadata. | PAM adding and removing IAM role bindings, or someone changing a Cloud Run service. |
| **Data Access** | Reads of configuration, metadata, or user-provided data for services where these logs are enabled. | Viewing sensitive logs or reading data from supported services. |
| **Policy Denied** | Requests blocked by a security policy. | A broad role tried to delete a production project, but a deny policy blocked it. |
| **System Event** | Google Cloud system actions that change configuration. | Managed service activity that changes resources without a direct user action. |

A simple Logs Explorer query for incident evidence might focus on the principal, project, and time window:

```logging
resource.type="audited_resource"
protoPayload.authenticationInfo.principalEmail="maya@example.com"
timestamp >= "2026-06-14T16:00:00Z"
timestamp <= "2026-06-14T19:15:00Z"
```

Use this in Logs Explorer or as the filter body for `gcloud logging read` when the evidence question starts with one person and one incident window. The principal filter selects Maya's actions, and the timestamps bracket the PAM grant plus a small buffer.

A useful result should show the principal, service, method, resource, and timestamp:

```yaml
timestamp: '2026-06-14T16:42:11.219Z'
protoPayload:
  authenticationInfo:
    principalEmail: maya@example.com
  serviceName: run.googleapis.com
  methodName: google.cloud.run.v2.Services.GetService
resource:
  labels:
    project_id: checkout-prod
```

A second query can focus on IAM policy changes during the incident window:

```logging
resource.type="project"
protoPayload.methodName:"SetIamPolicy"
timestamp >= "2026-06-14T16:00:00Z"
timestamp <= "2026-06-14T19:15:00Z"
```

This query looks for IAM policy changes, including temporary grants and removals. A reviewer should inspect the caller, the target project, and the delta in the policy change:

```yaml
timestamp: '2026-06-14T16:21:04.771Z'
protoPayload:
  authenticationInfo:
    principalEmail: privilegedaccessmanager.googleapis.com
  methodName: SetIamPolicy
  resourceName: projects/checkout-prod
  serviceData:
    policyDelta:
      bindingDeltas:
      - action: ADD
        member: user:maya@example.com
        role: roles/logging.viewer
```

Those queries are only starting points. Real investigations usually add the project ID, service name, method names, or PAM-related fields once the first results show the shape of the event. The important habit is to capture the evidence package while the incident is still fresh: request reason, approval, grant start and end time, IAM changes, production actions, and any policy denials.

![Audit evidence package](/content-assets/articles/article-cloud-providers-gcp-identity-security-guardrails-temporary-access-audit-evidence/audit-evidence-package.png)
*An after-incident evidence package should prove approval, IAM change, production activity, policy denials, and cleanup without relying on memory.*

Data Access audit logs deserve extra planning. Admin Activity logs are written by default and stay enabled. Data Access logs can be large and start disabled by default for many services outside BigQuery, so security teams decide which production services need them, where to route them, who can read them, and how long to retain them. A team that waits until after a sensitive incident to enable Data Access logs may have a gap in the evidence.

## Break-Glass Access
<!-- section-summary: Break-glass access is reserved emergency access with strict protection, approval, monitoring, and after-action review. -->

**Break-glass access** is emergency access for the moment when the normal path is unavailable or too slow for the risk in front of the team. It might be needed if the identity provider is down, PAM is unavailable, a bad IAM change locked out normal administrators, or a production incident threatens customer data while the usual approval chain lacks time.

Break-glass accounts should stay separate from daily work. They need strong multi-factor authentication, a small owner list, clear storage and recovery procedures, and alerting when anyone signs in or uses them. The access should be powerful enough to recover the environment, but the process around it should make casual use uncomfortable and visible.

In the checkout story, PAM should be the normal first tool for temporary production debugging and log inspection. Break-glass would enter the story only if the normal identity path failed during the incident, or if a misconfigured deny or boundary policy blocked the platform team from restoring access. When someone uses break-glass, the incident record should explain why PAM or normal administrator access was unavailable for the situation.

A strong break-glass procedure records:

| Control | What It Captures |
|---|---|
| **Named emergency identities** | Which account or group can recover access. |
| **Credential protection** | How MFA devices, passkeys, recovery codes, and passwords are stored. |
| **Activation reason** | Incident number, business impact, and why normal access was unavailable. |
| **Real-time alerting** | Security and platform notifications when the identity signs in or changes IAM. |
| **After-action cleanup** | Password rotation, session review, audit log export, and a written follow-up. |

Real emergencies happen, so the access path needs to be rare, monitored, and reviewable. A break-glass path that nobody tests can fail at the worst moment. A break-glass path used for ordinary debugging is just permanent privileged access with a dramatic name. The healthy middle is a tested procedure with clear evidence requirements.

## Terraform Review Habits for IAM Changes
<!-- section-summary: Terraform IAM diffs need reviewers to inspect scope, role size, principal type, expiration, and interaction with PAM-managed bindings. -->

Terraform is often the place where IAM access is applied. A pull request can grant a role at the organization, folder, project, or resource level. It can also change deny policies, conditional bindings, service account impersonation, logging sinks, and the resources that IAM policies protect. That means Terraform review is a security review as much as an infrastructure review.

The first Terraform habit is to review the **scope** before the role name. A `roles/logging.viewer` binding on one project has a small blast radius. The same role on the production folder gives visibility into every project below that folder. A service account impersonation role on one deployer service account is one thing; the same permission across a folder can create a lateral movement path.

The second habit is to review the **resource type** used by the Google provider. Authoritative IAM resources manage a whole policy or a whole role binding and can remove members that another system added. Non-authoritative member resources manage a single member binding. When PAM manages temporary role bindings, non-authoritative Terraform resources reduce the chance that an apply removes PAM's active grants.

The third habit is to require a clear story for every production IAM change. The pull request should say who receives access, which role they receive, where the role is attached, why the role is needed, how long it should last, and which ticket or incident owns the request. If the answer is "debug checkout failures for two hours," the review should prefer PAM or a conditional binding. If the answer is "normal on-call log visibility," the review should prefer a group binding with the narrowest stable role.

This conditional binding example carries review-friendly information in the resource name, condition title, and description:

```hcl
resource "google_project_iam_member" "checkout_oncall_log_viewer" {
  project = "checkout-prod"
  role    = "roles/logging.viewer"
  member  = "group:checkout-oncall@example.com"

  condition {
    title       = "checkout_oncall_business_hours"
    description = "Checkout on-call log access for production support"
    expression  = "request.time.getDayOfWeek(\"Europe/London\") >= 1 && request.time.getDayOfWeek(\"Europe/London\") <= 5"
  }
}
```

This config is consumed as a stable Terraform-managed IAM member binding for the checkout on-call group. The `member` field uses a group instead of a personal user so the identity team can manage membership separately, and the `condition` expression makes the intended support window visible to reviewers. If the team needs true 24/7 incident visibility, the reviewer should change the design rather than silently accept a business-hours condition that conflicts with operations.

The plan should make the scope and condition easy to inspect:

```hcl
# google_project_iam_member.checkout_oncall_log_viewer will be created
+ resource "google_project_iam_member" "checkout_oncall_log_viewer" {
    project = "checkout-prod"
    role    = "roles/logging.viewer"
    member  = "group:checkout-oncall@example.com"

    condition {
      title       = "checkout_oncall_business_hours"
      description = "Checkout on-call log access for production support"
      expression  = "request.time.getDayOfWeek(\"Europe/London\") >= 1 && request.time.getDayOfWeek(\"Europe/London\") <= 5"
    }
  }
```

That example is a teaching shape rather than a universal recommendation. Many teams give on-call groups stable log visibility because incidents happen outside business hours. The useful part is the review pattern: the condition is visible, the principal is a group rather than a personal user, and the scope is one production project rather than the organization.

For IAM pull requests, reviewers should pause on these changes:

| Terraform Diff | Reviewer Concern |
|---|---|
| `google_organization_iam_*` | Company-wide blast radius. |
| `google_folder_iam_*` | Every child project inherits the role. |
| `roles/owner`, `roles/editor`, `roles/viewer` | Basic roles grant broad access across many services. |
| `roles/iam.serviceAccountTokenCreator` or `roles/iam.serviceAccountUser` | The principal may act as or mint tokens for a service account. |
| IAM resources with no condition for a short request | Temporary work may turn into permanent access. |
| Authoritative IAM resources around PAM-managed resources | Terraform may remove temporary grants managed by PAM. |
| Logging sink or retention changes | Audit evidence may disappear or move beyond reviewer access. |

Good Terraform review makes the production access story clear. The diff says what changed. The ticket says why. The IAM scope is narrow. Temporary access has an expiration path. Audit logs prove what happened after the change.

## Access Review Cadence
<!-- section-summary: Access reviews need different rhythms for emergency access, temporary grants, broad roles, recommendations, and Terraform drift. -->

Access review works best as a routine, because production IAM rarely fails all at once. It drifts. A temporary grant misses cleanup. A folder-level group gains a new member. A service account keeps an old broad role after the deployment pipeline changed. A logging sink loses a destination during a refactor. The combined effect weakens the identity layer.

A cadence gives each kind of risk a normal review window:

| Cadence | Review Area | Evidence |
|---|---|---|
| **After each incident** | PAM grants, manual IAM changes, break-glass usage, and audit queries for the incident window. | Incident ticket, approval record, Cloud Audit Logs, and cleanup PR. |
| **Weekly** | Active or recently expired temporary grants, emergency access alerts, and unusual Policy Denied logs. | PAM grant list, alert history, and Logs Explorer queries. |
| **Monthly** | Project and folder IAM changes, broad roles, service account impersonation grants, and logging sink health. | Terraform diffs, Cloud Asset Inventory exports, Recommender findings, and audit log routes. |
| **Quarterly** | Organization-level IAM, production folder inheritance, principal access boundaries, deny policies, and break-glass procedure tests. | Access certification, policy review notes, test evidence, and owner sign-off. |

The checkout incident creates a simple after-incident checklist. The review should show that Maya's PAM grant ended, no manual IAM binding remains, the audit log package includes approval and removal evidence, and break-glass stayed unused. Any discovered permanent broad role turns into a remediation item with IAM Recommender evidence and a Terraform pull request.

The cadence also keeps ownership visible. Security teams usually own organization guardrails, deny policies, principal access boundaries, and break-glass policy. Platform teams usually own PAM entitlements, Terraform modules, and shared logging routes. Product teams usually own whether their service groups still need the access they have. A review that names the owner has a much better chance of producing a change instead of a spreadsheet nobody trusts.

## Putting It All Together
<!-- section-summary: A good GCP production access workflow grants short-lived access, keeps guardrails active, records approval, checks logs, and removes access cleanly. -->

Let's replay the checkout incident with the full workflow in place. The team starts by checking whether Maya already has the right access through a production folder group. The review shows that baseline access allows normal dashboard visibility, but detailed production log inspection requires a temporary role. The folder already has deny policies that block project deletion and other high-risk actions, so emergency debugging stays inside those hard lines.

Maya requests the `checkout-prod-debugging` PAM entitlement for two hours and includes the incident number. The incident commander approves the request. PAM grants `roles/logging.viewer` and `roles/run.viewer` on the `checkout-prod` project, and the principal access boundary for checkout engineers keeps the eligible resource area focused on checkout-owned production resources.

Maya inspects Cloud Run revisions and logs, finds that payment callback requests started timing out after a provider endpoint changed behavior, and shares the evidence in the incident channel. The application team rolls back the checkout configuration. PAM removes Maya's temporary role bindings when the grant ends, and the team confirms in Cloud Audit Logs that the access appeared, was used for the incident, and was removed.

After the incident, the team reviews the permanent access that made the investigation possible. IAM Recommender shows one old broad role on a checkout deployment service account, so the platform team opens a Terraform pull request to replace it with narrower roles. Security reviews the folder-level guardrails and confirms that the deny policies, principal access boundary bindings, and logging routes still match the production access design.

That is the whole pattern. **Inherited access gets reviewed before new access is granted. Deny policies create hard stops. Principal access boundaries keep principals inside their expected resource area. IAM Recommender reduces permanent excess. PAM handles temporary elevated access. Cloud Audit Logs prove who did what, where, and when. Break-glass stays separate. Terraform IAM changes receive security-level review.** When those habits work together, production access can be fast during an incident and still leave a clean explanation afterward.

---

**References**

- [Google Cloud: Using resource hierarchy for access control](https://cloud.google.com/iam/docs/resource-hierarchy-access-control) - Explains organization, folder, project, and resource-level IAM inheritance.
- [Google Cloud: Manage access to projects, folders, and organizations](https://cloud.google.com/iam/docs/granting-changing-revoking-access) - Documents how allow policies grant roles on parent resources and descendants.
- [Google Cloud: Deny policies](https://cloud.google.com/iam/docs/deny-overview) - Describes deny policy structure, inheritance, deny rules, and conditions.
- [Google Cloud: Principal access boundary policies](https://cloud.google.com/iam/docs/principal-access-boundary-policies) - Explains how principal access boundaries restrict eligible resource access for principal sets.
- [Google Cloud: Overview of role recommendations](https://cloud.google.com/iam/docs/recommender-overview) - Describes IAM Recommender, role recommendations, policy insights, observation periods, and excessive-permission cleanup.
- [Google Cloud: Privileged Access Manager overview](https://cloud.google.com/iam/docs/pam-overview) - Explains PAM concepts, grant retention, and Terraform interaction with PAM-managed role bindings.
- [Google Cloud: Request temporary elevated access with PAM](https://cloud.google.com/iam/docs/pam-request-temporary-elevated-access) - Documents requesting grants against entitlements for a fixed duration.
- [Google Cloud: Create entitlements in Privileged Access Manager](https://cloud.google.com/iam/docs/pam-create-entitlements) - Documents entitlement roles, requesters, approvers, conditions, and maximum grant duration.
- [Google Cloud: Cloud Audit Logs overview](https://cloud.google.com/logging/docs/audit) - Explains Admin Activity, Data Access, System Event, Policy Denied logs, and caller identity fields.
- [Google Cloud: Configure temporary access](https://cloud.google.com/iam/docs/configuring-temporary-access) - Shows time-bounded access with conditional role bindings.
- [Google Cloud: IAM Conditions overview](https://cloud.google.com/iam/docs/conditions-overview) - Explains conditional access in allow policies, deny policies, and principal access boundary policy bindings.
