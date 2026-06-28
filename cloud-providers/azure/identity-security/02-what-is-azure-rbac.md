---
title: "What Is Azure RBAC?"
description: "Understand how Azure RBAC grants access through principals, role definitions, scopes, role assignments, evaluation, and evidence."
overview: "Microsoft Entra ID proves who the caller is, and Azure RBAC decides what that caller can do to Azure resources. This article follows the Orders team through principals, object IDs, role definitions, actions, scopes, role assignments, least privilege, and the evidence teams use during access reviews."
tags: ["azure", "rbac", "authorization", "roles", "scopes"]
order: 2
id: article-cloud-providers-azure-identity-security-what-is-azure-rbac
aliases:
  - what-is-azure-rbac
  - azure-rbac
  - azure-rbac-roles-and-scopes
  - azure-identity-and-access-control
  - cloud-providers/azure/identity-security/what-is-azure-rbac.md
  - cloud-providers/azure/identity-security/azure-rbac-roles-and-scopes.md
---

## Table of Contents

1. [What Is Azure RBAC](#what-is-azure-rbac)
2. [Principals](#principals)
3. [Microsoft Entra](#microsoft-entra)
4. [Object IDs](#object-ids)
5. [Role Definitions](#role-definitions)
6. [Actions and Data Actions](#actions-and-data-actions)
7. [Scopes](#scopes)
8. [Role Assignments](#role-assignments)
9. [How Azure Evaluates Access](#how-azure-evaluates-access)
10. [Least Privilege Review](#least-privilege-review)
11. [Evidence](#evidence)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## What Is Azure RBAC
<!-- section-summary: Azure RBAC is Azure's authorization system for deciding which authenticated principal can perform which action at which Azure scope. -->

In the previous article, we talked about **Microsoft Entra ID** as the place where Azure learns who a person, app, or workload is. That identity step matters, but production access needs one more question. After Azure knows the caller, Azure has to decide what that caller can actually do. That decision is where **Azure role-based access control**, usually called **Azure RBAC**, comes in.

Azure RBAC is Azure's authorization system for Azure resources. In beginner-friendly words, it is the system that connects a known caller to a permission bundle at a specific Azure boundary. A support engineer can inspect a resource group, a deployment pipeline can update one web app, and a running API can write files to one storage account because Azure RBAC has records that say those exact jobs are allowed.

For AWS readers, Azure RBAC fills the same authorization job that IAM policies and roles often fill for AWS resources. The Azure detail to notice is the **role assignment**: a principal receives a role at a management group, subscription, resource group, or resource scope, while AWS designs often combine account boundaries, identity policies, resource policies, and role trust.

We can read almost every Azure RBAC problem through four pieces: **principal**, **role**, **scope**, and **action**. The principal is who or what asks for access. The role is the permission bundle. The scope is where that role applies. The action is the operation Azure receives, such as reading a resource, updating an app setting, creating a role assignment, or writing a blob.

![Azure RBAC four fact decision map showing principal, role, scope, and action meeting at an access check](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-azure-rbac/rbac-decision-four-facts.png)

*A good Azure RBAC review names the principal, role, scope, and action instead of asking for broad Azure access.*

Let's follow one Orders production system through the whole article. Maya is an engineer who investigates incidents. `spn-orders-deploy-prod` is the deployment identity that ships the app. `mi-orders-api-prod` is the managed identity used by the running API. These callers all belong to the same story, but they need different access because their jobs are different. The deployment identity gives us a useful first example because a denied deployment usually names the caller, action, and target resource right in the error.

```yaml
error: AuthorizationFailed
caller: spn-orders-deploy-prod
action: Microsoft.Web/sites/config/write
scope: /subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.Web/sites/app-orders-prod
```

That error already gives us most of the access question. The caller is `spn-orders-deploy-prod`. The target action is `Microsoft.Web/sites/config/write`. The target scope is the production App Service resource. The missing piece is a role assignment that gives that caller a role containing the write action at that resource scope or at a parent scope.

So the first useful habit is simple: **turn vague access requests into concrete RBAC facts**. "The pipeline needs Azure access" is too broad to review. "The deployment service principal needs permission to write App Service configuration for `app-orders-prod`" gives the team something they can check, approve, automate, and later remove.

## Principals
<!-- section-summary: A principal is the exact user, group, service principal, managed identity, or workload identity that receives an Azure role assignment. -->

A **principal** is the identity that receives access in Azure RBAC. It can be a user, a security group, a service principal, a managed identity, or a workload identity. Microsoft Entra ID creates and manages these identities, and Azure RBAC uses them as the who side of the authorization decision.

For the Orders team, Maya is a **user principal** because she is a person. `grp-orders-engineers` is a **group principal** because it represents a team. `spn-orders-deploy-prod` is a **service principal** because it represents software used by the deployment pipeline. `mi-orders-api-prod` is a **managed identity** because it represents an Azure-hosted workload whose credential lifecycle Azure manages.

| Principal type | Plain-English meaning | Orders example |
|---|---|---|
| **User** | One human account in the tenant | `maya@devpolaris.com` |
| **Group** | A collection of identities managed together | `grp-orders-engineers` |
| **Service principal** | A tenant-local software identity | `spn-orders-deploy-prod` |
| **Managed identity** | An Azure-managed workload identity | `mi-orders-api-prod` |
| **Workload identity** | An external workload that exchanges trusted proof for Azure access | GitHub Actions deploying Orders |

Groups are usually the cleanest way to give humans shared access. The platform team can assign Reader to `grp-orders-engineers` at the Orders resource group, then update group membership when engineers join or leave. That gives access review one team object to inspect instead of twenty separate user assignments that all try to describe the same job.

Software access usually deserves its own principal. A deployment job gets cleaner evidence with its own service principal, because the audit trail then points at the pipeline instead of making the deployment look like a human action. A running API gets safer access with a managed identity or service principal instead of a shared static secret that five people can copy. A named service principal or managed identity gives the workload its own caller name, owners, assignments, and logs.

This is where production reviews become much clearer. If an activity log says `spn-orders-deploy-prod` changed an App Service setting, the reviewer follows the deployment identity, its owners, its credential or federation setup, and its Azure RBAC assignments. Maya might have approved the pull request, but the service principal made the Azure request. Once the caller is clear, the next step is understanding where Azure stores that caller and how sign-in connects to RBAC.

## Microsoft Entra
<!-- section-summary: Microsoft Entra ID authenticates callers and stores the identity records that Azure RBAC uses for resource access decisions. -->

**Microsoft Entra ID** is Microsoft's cloud identity system. It stores users, groups, service principals, managed identities, devices, application objects, and many sign-in policy records. When a caller signs in or a workload asks for a token, Microsoft Entra ID handles the authentication side first.

**Authentication** means proving the caller's identity. **Authorization** means deciding what that known caller can do. The split matters because a successful sign-in only proves the identity side. Maya can sign in to the Azure portal, pass MFA, and still see an access error if Azure RBAC has no role assignment for her at the production scope.

The same split applies to software. `mi-orders-api-prod` can get a token for its managed identity through Microsoft Entra ID. That token proves the workload identity. Storage still checks Azure RBAC before accepting a blob write, and Key Vault still checks Azure RBAC before returning a secret value.

![Identity and authorization flow from caller through Microsoft Entra ID to Azure RBAC and the Azure resource](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-azure-rbac/identity-rbac-boundary.png)

*Microsoft Entra ID proves the caller and issues a token, while Azure RBAC checks whether that caller has a matching assignment for the resource action.*

This explains a common support ticket. Someone says, "I can log in, but Azure blocks the app update." The login side worked. The authorization side still needs a principal, a role, and a scope that match the requested Azure action.

Microsoft Entra ID and Azure RBAC meet at the principal record. The friendly name helps humans talk, but automation and review need the exact identifier for that record. That identifier is the object ID.

## Object IDs
<!-- section-summary: Object IDs identify the exact Microsoft Entra principal that receives access, which keeps names and app IDs from pointing at the wrong caller. -->

An **object ID** is the unique identifier for one Microsoft Entra object inside one tenant. Users, groups, service principals, and managed identities all have object IDs. Azure RBAC role assignments store the principal ID, and that principal ID is the object ID of the identity receiving access.

Display names are helpful during conversation, but they can confuse automation. A tenant can have two users named Alex Chen. A managed identity and a service principal can use similar names. A deleted identity can leave an old role assignment where Azure can no longer resolve the display name. A script that assigns access by name can also hit the wrong object if the name changes or appears more than once. The Orders deployment identity shows why reviewers look past the friendly name and compare the stable IDs.

| Field | What it means | Example |
|---|---|---|
| **Display name** | Human-friendly label | `spn-orders-deploy-prod` |
| **Application or client ID** | App registration identifier used by code and token flows | `0f4c7a29-2222-5555-bbbb-23456789abcd` |
| **Object ID / principal ID** | Exact tenant object that receives Azure RBAC access | `9b7e2a10-3333-6666-cccc-3456789abcde` |

The role assignment cares about the object ID. The client ID may appear in token configuration, app code, and workload federation setup. The display name may appear in dashboards and conversations. The object ID is the stable field reviewers use when they need to prove that a specific principal received a specific role assignment. A clean access request for the Orders deployment identity can include all the friendly context, but it should still carry the principal ID.

```json
{
  "principalName": "spn-orders-deploy-prod",
  "principalType": "ServicePrincipal",
  "principalId": "9b7e2a10-3333-6666-cccc-3456789abcde",
  "requestedAction": "Microsoft.Web/sites/config/write",
  "targetScope": "/subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.Web/sites/app-orders-prod"
}
```

Now the reviewer knows the exact caller, so the next question is permission-shaped: which role contains the action the caller needs? That takes us from identity records into role definitions.

## Role Definitions
<!-- section-summary: A role definition is the reusable permission bundle that lists allowed Azure management actions and, for supported services, data actions. -->

A **role definition** is a reusable bundle of permissions. People usually shorten that phrase to **role**. Azure provides many built-in roles, and organizations can create custom roles when a production job needs a permission shape that built-in roles grant too broadly or too narrowly.

Some built-in roles are broad. **Reader** can view Azure resources. **Contributor** can create and change many Azure resources, while access management stays separate. **Owner** includes broad resource control and permission to manage access. **Role Based Access Control Administrator** and **User Access Administrator** focus on assigning access to Azure resources.

Other roles match service jobs more directly. **Website Contributor** fits many App Service operations. **Storage Blob Data Reader** and **Storage Blob Data Contributor** control blob data access. **Key Vault Secrets User** allows reading secret values from a vault that uses Azure RBAC for authorization. These service-specific roles usually make a cleaner production request than a broad subscription role.

| Job | Role idea | Scope idea |
|---|---|---|
| Inspect resources during an incident | Reader | `rg-orders-prod` |
| Update one web app's configuration | Website Contributor or custom app settings role | `app-orders-prod` |
| Write monthly export blobs | Storage Blob Data Contributor | `stordersprodexports` storage account or container |
| Read secret values at runtime | Key Vault Secrets User | `kv-orders-prod` |
| Manage role assignments for a platform team | Role Based Access Control Administrator | production management group or subscription |

When a request names a role, the reviewer should inspect what that role actually contains. This read-only command asks Azure for the action list behind a built-in role.

```bash
az role definition list \
  --name "Website Contributor" \
  --query "[0].{roleName:roleName, actions:permissions[0].actions, dataActions:permissions[0].dataActions}"
```

The output should show management actions for web resources and an empty data-action list. That tells the reviewer this role can help with App Service configuration work, while a blob or Key Vault data request needs a different role.

```json
{
  "roleName": "Website Contributor",
  "actions": [
    "Microsoft.Web/*",
    "Microsoft.Insights/alertRules/*",
    "Microsoft.Authorization/*/read",
    "Microsoft.Resources/deployments/*"
  ],
  "dataActions": []
}
```

A custom role helps when the built-in role grants more than the job needs. The Orders deployment pipeline might need to read the App Service, read configuration, and write configuration, while delete operations, networking changes, and access-management actions stay outside the deployment job. A custom role can list the narrow App Service actions the pipeline needs, and `AssignableScopes` can say where that custom role can be assigned. A simplified custom role for this deployment case can keep the action list close to the actual App Service configuration job.

```json
{
  "roleName": "Orders App Settings Writer",
  "description": "Read and update App Service configuration for the Orders production app.",
  "permissions": [
    {
      "actions": [
        "Microsoft.Web/sites/read",
        "Microsoft.Web/sites/config/read",
        "Microsoft.Web/sites/config/write"
      ],
      "notActions": [],
      "dataActions": [],
      "notDataActions": []
    }
  ],
  "assignableScopes": [
    "/subscriptions/sub-prod-001/resourceGroups/rg-orders-prod"
  ]
}
```

That JSON introduces the next important split. Azure roles contain action strings, and Azure separates management-plane actions from data-plane actions for services that support data access through Azure RBAC.

## Actions and Data Actions
<!-- section-summary: Azure role definitions contain management-plane actions and, for supported services, data-plane actions that control access to service data. -->

An **action** is an Azure operation. A role definition lists management-plane operations in `Actions` and data-plane operations in `DataActions`. It can also use `NotActions` and `NotDataActions` as subtraction lists inside that same role definition.

The **management plane** controls Azure resource configuration through Azure Resource Manager. Creating a resource group, updating App Service configuration, resizing a database, changing a virtual network, or deleting a virtual machine all belong to this side. The Orders pipeline error used a management action: `Microsoft.Web/sites/config/write`.

The **data plane** controls the data inside a service for services that integrate those operations with Azure RBAC. Reading a blob, writing a blob, reading a Key Vault secret value, or handling queue messages can belong to this side. This split explains why someone can see a storage account in the portal but still fail when they try to read the blobs inside it. The management permission opens the resource view, while the data permission controls the contents.

| Permission question | Plane | Example action |
|---|---|---|
| Can Maya view the storage account resource? | Management plane | `Microsoft.Storage/storageAccounts/read` |
| Can the API write blob objects into the storage account? | Data plane | `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write` |
| Can the pipeline update App Service settings? | Management plane | `Microsoft.Web/sites/config/write` |
| Can the API read a Key Vault secret value? | Data plane | Key Vault secret data action through an RBAC data role |

`NotActions` and `NotDataActions` need careful reading. They subtract actions from the allowed actions in one role definition, usually when the role uses a wildcard. Another role assignment can still grant the same operation through a different role. For strong blocking, Azure has **deny assignments**, which Azure creates and manages for specific platform scenarios such as protected managed resources. Actions tell us what the role can do, and the next RBAC piece tells us how far that permission reaches.

## Scopes
<!-- section-summary: Scope is the Azure boundary where a role assignment applies, and child scopes inherit assignments from parent scopes. -->

A **scope** is the Azure boundary where a role assignment applies. Azure RBAC uses a hierarchy: **management group**, **subscription**, **resource group**, and **resource**. A role assignment at a parent scope flows down to child scopes under it.

![Azure RBAC scope inheritance map from management group to subscription, resource group, and resources](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-azure-rbac/scope-inheritance-map.png)

*Scope chooses how far an assignment reaches; assigning at `rg-orders-prod` covers the child resources without opening the whole subscription.*

This hierarchy turns least privilege into a real design choice. Reader at the production subscription lets Maya inspect every resource group in that subscription. Reader at `rg-orders-prod` limits her normal view to the Orders production resources. Reader on one App Service limits the assignment to that single resource.

For the deployment pipeline, the useful scope depends on the job. If the pipeline only changes `app-orders-prod`, the App Service resource scope fits the request. If the pipeline deploys the web app, its app settings, and a few related resources together, the resource group scope may fit. Subscription scope reaches every resource group in that subscription, so a reviewer should expect a strong reason before approving it.

Inheritance also explains surprising access. A user may have no assignment directly on a web app, but still have Contributor because a group received Contributor at the subscription. A useful access review checks the target resource, its parent resource group, the subscription, the management group path, and any group membership that contributes access. Now we have a principal, a role, and a scope, and Azure grants access when those pieces come together in a role assignment.

## Role Assignments
<!-- section-summary: A role assignment binds one principal to one role definition at one scope, which is the record that grants Azure access. -->

A **role assignment** is the access record that binds one principal, one role definition, and one scope. The role definition describes the permission bundle. The scope describes where the permission applies. The principal describes who receives it. The assignment is the actual grant.

The Orders API needs to write monthly export files to Storage. The principal is `mi-orders-api-prod`. The role is `Storage Blob Data Contributor`. The scope is the storage account used for exports. Those three facts produce one role assignment:

```bash
az role assignment create \
  --assignee-object-id 9b7e2a10-3333-6666-cccc-3456789abcde \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports
```

That command uses the object ID because the assignment should target the exact managed identity service principal. The principal type helps deployment tooling avoid lookup timing issues, especially with service principals and managed identities that may have been created recently. The assignment evidence has the same three-part shape, which makes it easy to compare the intended access request with the actual Azure record.

```json
{
  "principalName": "mi-orders-api-prod",
  "principalType": "ServicePrincipal",
  "roleDefinitionName": "Storage Blob Data Contributor",
  "scope": "/subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports"
}
```

This record gives one workload identity one storage data role at one storage account. If the API later needs to read secret values from Key Vault, the team creates another role assignment with a Key Vault role at the vault scope. Each access path gets its own reason, role, and boundary.

The same assignment should be easy to find later. Listing by principal ID and narrowing the output to the role and scope gives a small evidence record for access review.

```bash
az role assignment list \
  --assignee 9b7e2a10-3333-6666-cccc-3456789abcde \
  --include-inherited \
  --query "[].{role:roleDefinitionName, principalType:principalType, scope:scope}"
```

A focused output lets the reviewer compare real assignments with the original request. The returned scope also reveals inherited access because a subscription or resource-group assignment can appear while the reviewer is checking one child resource. If the storage role appears at subscription scope, the team should ask why the API needs every storage account in the subscription instead of the Orders export account.

```json
[
  {
    "role": "Storage Blob Data Contributor",
    "principalType": "ServicePrincipal",
    "scope": "/subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports"
  }
]
```

Creating role assignments also requires permission. A caller needs access such as `Microsoft.Authorization/roleAssignments/write`, usually through Owner, User Access Administrator, or Role Based Access Control Administrator at the relevant scope. That power deserves extra care because someone who can grant access can change who reaches production. After the team creates assignments, Azure has to evaluate them on every request.

## How Azure Evaluates Access
<!-- section-summary: Azure evaluates the token, deny assignments, applicable role assignments, action match, scope, and conditions before allowing a request. -->

Azure evaluates RBAC at request time. The caller gets a token from Microsoft Entra ID, sends a request to Azure Resource Manager or a supported data-plane service, and Azure checks the assignments that apply to the target resource. The request succeeds only when the caller has a matching grant for the action at the target scope. The flow below shows the order a troubleshooting conversation usually follows, starting with the token and ending with allow or deny.

![Azure RBAC request-time evaluation path showing token, action, deny assignments, role assignments, action match, conditions, and allow or deny](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-azure-rbac/rbac-evaluation-path.png)

*Troubleshooting usually follows the request path: token, action, target, deny checks, matching assignments, action contents, conditions, and then allow or deny.*

Several details matter during a real incident. Group assignments can contribute access because the caller may receive roles through group membership. Parent scopes can contribute access because assignments inherit down the hierarchy. Deny assignments block matching actions even when a role assignment grants them. Role assignment conditions can narrow supported assignments, especially for some storage data scenarios.

The deployment error from the beginning now has a clear path. `spn-orders-deploy-prod` had a token. Azure received `Microsoft.Web/sites/config/write` against `app-orders-prod`. Azure checked deny assignments, then role assignments for the service principal and any relevant groups at the resource, resource group, subscription, and management group scopes. The request failed because the effective assignments lacked that write action at that target.

Role assignment changes can also take time to show up everywhere. During an incident, a new assignment may need propagation time before every provider and cache sees it. The practical response is to verify the role assignment evidence, wait briefly when propagation fits the timing, and retest the same denied action.

Evaluation gives us the mechanics. Least privilege gives us the review habit before we create or widen an assignment.

## Least Privilege Review
<!-- section-summary: Least privilege starts from the job, action, principal, and target scope, then chooses the narrowest role assignment that supports the workflow. -->

**Least privilege** means giving the access required for the job and avoiding extra reach. In Azure RBAC, least privilege is a concrete review because every request can name a principal, an action, a role, and a scope.

The Orders API gives us a good example. A broad ticket might say, "Give the API Contributor on production so exports work." That request would let the API change many resources that have nothing to do with writing export files. A better version says, "Grant `mi-orders-api-prod` `Storage Blob Data Contributor` on the export storage account so it can write monthly export blobs."

| Review question | Orders answer |
|---|---|
| **Who is the exact principal?** | `mi-orders-api-prod`, object ID confirmed |
| **What job needs access?** | Write monthly order export blobs |
| **Which action family supports the job?** | Storage blob data write operations |
| **Which role fits the job?** | Storage Blob Data Contributor |
| **Which scope contains the job?** | `stordersprodexports` storage account, or a container scope if the design uses one |
| **Who owns approval?** | Platform owner for production data access |

Broad roles still appear in real environments, but they need a reason. Owner at subscription scope can fit emergency or platform administration procedures. Contributor at subscription scope can fit a platform pipeline that owns the whole subscription. Those same roles usually create too much reach for one application runtime, one support team, or one narrow deployment job.

Custom roles belong after the team understands the needed actions. Starting with a built-in role is common because Microsoft maintains those roles as services evolve. A custom role adds ownership work because the team has to review action strings, wildcard choices, assignable scopes, and future service changes.

Least privilege should also include time and review. Privileged Identity Management can make eligible human access temporary and approval-based. Periodic access reviews help teams remove old group members, retired workload identities, stale service principals, and role assignments that no longer match the job. After the team chooses access carefully, evidence keeps the system understandable.

## Evidence
<!-- section-summary: Azure RBAC evidence comes from Access control (IAM), role assignment lists, activity logs, denied action messages, and review records. -->

**Azure RBAC evidence** is the information that explains who had access, what role granted it, where it applied, and which request failed or succeeded. The Azure portal shows this through **Access control (IAM)** on management groups, subscriptions, resource groups, and resources. The Azure CLI, REST API, and infrastructure tools expose the same assignment records for automation and review. For a focused investigation, the Orders platform team can list assignments for the workload identity by object ID.

```bash
az role assignment list \
  --assignee 9b7e2a10-3333-6666-cccc-3456789abcde \
  --all
```

The useful output fields are the principal, role, and scope. Those fields let the reviewer compare the role assignment record with the original access request.

```json
[
  {
    "principalName": "mi-orders-api-prod",
    "principalType": "ServicePrincipal",
    "roleDefinitionName": "Storage Blob Data Contributor",
    "scope": "/subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports"
  },
  {
    "principalName": "mi-orders-api-prod",
    "principalType": "ServicePrincipal",
    "roleDefinitionName": "Key Vault Secrets User",
    "scope": "/subscriptions/sub-prod-001/resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod"
  }
]
```

Denied request messages are also evidence. A useful `AuthorizationFailed` message names the caller, the action, and the target scope. That turns "the deployment is blocked" into "this service principal lacks a role containing `Microsoft.Web/sites/config/write` at the App Service scope or a parent scope."

Activity logs add change history. They can show who created or removed a role assignment, who changed a resource, and when the operation happened. Sign-in logs help with the identity side for users and service principals. Approval records and access review decisions explain why a powerful assignment existed in the first place.

Good evidence gives the team one plain sentence: **this principal has this role at this scope for this reason**. That sentence helps incident responders during a failure, auditors during a review, and future maintainers who inherit the system months later. With that evidence in hand, we can bring the whole story back together.

## Putting It All Together
<!-- section-summary: A secure Azure RBAC design connects Microsoft Entra identities, precise roles, narrow scopes, request-time evaluation, and reviewable evidence. -->

Azure RBAC starts after identity. Microsoft Entra ID stores the callers and issues tokens. Azure RBAC connects those callers to roles at scopes. Azure evaluates each request by checking the caller, the action, the target resource, deny assignments, applicable role assignments, role contents, and conditions.

The Orders team now has a production access shape that a beginner can read. Maya uses her user identity and receives human investigation access through `grp-orders-engineers`. The deployment pipeline uses `spn-orders-deploy-prod` and receives the App Service configuration actions it needs at the app or resource group scope. The runtime API uses `mi-orders-api-prod` and receives storage and Key Vault data roles at the resources it actually touches.

![Orders RBAC access map connecting Microsoft Entra principals to Azure RBAC roles and narrow resource scopes](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-azure-rbac/orders-rbac-summary.png)

*The Orders access map keeps each caller tied to a job-shaped role and the narrow resource scope that job needs.*

The access review habit is the main thing to keep. The caller has a principal ID. The requested operation has an action string. The target has a scope. The role definition contains the permission. The role assignment joins the principal, role, and scope. The evidence shows what Azure allowed, denied, created, or removed.

That is why Azure RBAC sits right after Microsoft Entra ID in this roadmap. Entra gives Azure a trusted caller. RBAC gives that caller bounded access to Azure resources.

## What's Next

The next article can move from authorization records into workload access. That is where managed identities help Azure-hosted applications call Azure services without storing long-lived client secrets.

---

**References**

- [What is Azure role-based access control?](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview)
- [Understand Azure role assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments)
- [Understand Azure role definitions](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-definitions)
- [Understand scope for Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/scope-overview)
- [Assign Azure roles using Azure CLI](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-cli)
- [List Azure deny assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/deny-assignments-portal)
- [Best practices for Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/best-practices)
- [Azure custom roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles)
- [Troubleshoot Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/troubleshooting)
