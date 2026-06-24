---
title: "What Is Microsoft Entra ID?"
description: "Understand Microsoft Entra ID as Azure's cloud identity layer: tenants, users, groups, devices, app registrations, service principals, managed identities, tokens, Conditional Access, roles, and evidence."
overview: "Microsoft Entra ID gives Azure and Microsoft cloud apps a trusted place to identify people, software, devices, and automation. This article follows the Orders team through one production access story so tenants, users, groups, apps, managed identities, tokens, Conditional Access, Azure RBAC, and logs connect as one practical system."
tags: ["azure", "microsoft-entra-id", "identity", "security", "rbac"]
order: 1
id: article-cloud-providers-azure-identity-security-what-is-microsoft-entra-id
aliases:
  - what-is-entra-id
  - microsoft-entra-id
  - azure-ad
  - what-is-azure-ad
  - cloud-providers/azure/identity-security/what-is-microsoft-entra-id.md
---

## Table of Contents

1. [The Access Story](#the-access-story)
2. [The Identity Layer](#the-identity-layer)
3. [Tenants and Subscriptions](#tenants-and-subscriptions)
4. [Human Identities](#human-identities)
5. [Groups and Devices](#groups-and-devices)
6. [The Software Secret Problem](#the-software-secret-problem)
7. [App Registrations](#app-registrations)
8. [Service Principals](#service-principals)
9. [Managed Identities](#managed-identities)
10. [Tokens and Claims](#tokens-and-claims)
11. [Conditional Access](#conditional-access)
12. [Roles and Authorization](#roles-and-authorization)
13. [Evidence and Operations](#evidence-and-operations)
14. [Putting It All Together](#putting-it-all-together)
15. [What's Next](#whats-next)

## The Access Story
<!-- section-summary: This article follows one production Orders system so every Microsoft Entra ID concept has a real caller, target, and access decision. -->

We are going to build the picture from one production scenario. The Orders team runs `orders-admin-web`, an internal dashboard for support engineers, and `orders-api-prod`, an Azure-hosted API that reads secrets from Key Vault and writes order events to Storage. Maya works on the support team, the deployment pipeline ships the app, and the running API needs to call Azure services during every request.

Those three callers need different kinds of identity. Maya needs a **user** identity because she is a person. The support team needs a **group** because many people share the same job access. Maya's laptop can have a **device** identity because the company cares whether support work happens from a managed machine. The dashboard needs an **app registration** and a **service principal** because Microsoft sign-in and app permissions need a software identity. The API needs a **managed identity** because an Azure-hosted workload should call Key Vault without a password in code.

The access story has a simple order. First, an organization needs a directory, and in Azure that directory is a **Microsoft Entra tenant**. Next, people, apps, devices, and workloads get identity objects inside that tenant. Then Microsoft Entra ID checks sign-in policy and issues tokens. After that, Azure RBAC, Microsoft Entra roles, or the application itself decide what the caller can actually do.

![Orders identity map showing the Microsoft Entra tenant, human and workload identities, Conditional Access, tokens, Azure RBAC, and Key Vault](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-microsoft-entra-id/orders-identity-map.png)

*The Orders map keeps the whole access story in one place: Microsoft Entra ID stores the caller records, policy and tokens prove the caller, and Azure RBAC plus the target resource decide access.*

This structure matters because Microsoft Entra ID can feel like a pile of portal pages at first. Users live in one area, app registrations in another, managed identities show up through Azure resources, and logs sit somewhere else. The Orders story gives each concept a job, so every section can answer the same practical question: which caller needs access, how does that caller prove identity, and where does the final permission decision happen?

## The Identity Layer
<!-- section-summary: Microsoft Entra ID is the cloud identity service that Azure and many Microsoft cloud apps trust for authentication, policy checks, and tokens. -->

**Microsoft Entra ID** is Microsoft's cloud identity and access management service. In plain English, it is the trusted identity system that Azure, Microsoft 365, Dynamics, and many custom apps use when they need to know who or what is trying to sign in or call an API. Microsoft describes it as the foundational Microsoft Entra product for authentication, policy enforcement, and protection for users, devices, apps, and resources.

If you come from AWS, Microsoft Entra ID spans several familiar identity areas. It covers workforce sign-in patterns you may associate with IAM Identity Center, workload and application identities you may associate with IAM roles and trust policies, and app or customer identity patterns you may associate with Cognito or external identity systems.

The older name was **Azure Active Directory**, often shortened to Azure AD. Microsoft started the rename to Microsoft Entra ID in 2023, and the old name still appears in many older blog posts, screenshots, package names, portal paths, and scripts. The rename kept existing sign-in URLs, APIs, and tools working, so real production teams still search for both names while they learn and troubleshoot.

The first useful split is **identity** and **permission**. Identity answers who or what the caller is. Permission answers what that known caller can do. Microsoft Entra ID handles identity records, sign-in, policy checks, and token issuance; Azure RBAC handles many Azure resource permissions; Microsoft Entra roles handle directory administration; and application code may add its own app roles or rules.

For Maya, this means Microsoft Entra ID proves that `maya@devpolaris.com` is the person signing in. For `orders-api-prod`, it means Microsoft Entra ID can issue a token for the managed identity attached to the app. For the deployment pipeline, it means the pipeline can use a workload identity or service principal to prove itself before Azure checks what it may deploy.

That identity layer needs a home. The next section gives the Orders team a directory boundary, because every user, app, device, policy, and log record belongs to a tenant.

## Tenants and Subscriptions
<!-- section-summary: A Microsoft Entra tenant is the organization's identity directory, while Azure subscriptions hold resources and trust one tenant for identity. -->

A **Microsoft Entra tenant** is an isolated identity directory for an organization. It stores users, groups, devices, application registrations, service principals, managed identities, domains, roles, policies, and logs. A new tenant gets an initial domain such as `devpolaris.onmicrosoft.com`, and the organization can add a verified domain such as `devpolaris.com` for everyday sign-in names.

You can think about the tenant as the Orders team's identity home. Maya's user object lives there. The `grp-orders-support` group lives there. The `orders-admin-web` app registration and service principal live there. The managed identity for the production API also appears there as a service principal that Azure manages for the team.

An **Azure subscription** is the container for Azure billing, quotas, and resources. It holds resource groups, virtual networks, App Services, Key Vaults, Storage accounts, databases, and many other resources. Microsoft documents that every Azure subscription has a trust relationship with one Microsoft Entra tenant, and one tenant can be trusted by many subscriptions.

![Tenant and subscription split showing identity records in devpolaris.com and development, staging, and production subscriptions trusting that tenant](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-microsoft-entra-id/tenant-subscription-split.png)

*The split shows why one tenant can serve several subscriptions, and why directory moves need access planning before role assignments and managed identities still make sense.*

That trust relationship shows up during normal work. Maya signs in through `devpolaris.com`, and Azure can use that tenant identity while checking access to `sub-orders-prod`. The same tenant can support development, staging, and production subscriptions, so the company can reuse one workforce identity system across Azure environments.

The tenant boundary also explains a serious migration problem. If a subscription moves to a different directory, Azure role assignments tied to users, groups, service principals, and managed identities can lose their meaning because the trusted directory changed. That is why tenant and subscription changes usually need access planning, Key Vault checks, managed identity checks, and rollback notes.

Now the Orders team has a trusted directory and subscriptions that rely on it. The next concept is the most familiar caller in the directory: a person.

## Human Identities
<!-- section-summary: Users represent people in Microsoft Entra ID, and those user records drive sign-in, lifecycle, access assignment, and audit trails. -->

A **user** is a Microsoft Entra ID object that represents a person. A user has a sign-in name, display name, object ID, authentication methods, group memberships, role assignments, and directory attributes. When Maya signs in as `maya@devpolaris.com`, Microsoft Entra ID starts with that user record and then evaluates the sign-in around it.

The user record gives Maya one identity across many apps. The same identity can reach Azure portal, Microsoft 365, `orders-admin-web`, a GitHub Enterprise integration, or a custom support API. Each application still decides its own access details, but the sign-in starts from the same trusted person record in the tenant.

User lifecycle work matters as much as the first login. A new support engineer joins, and the identity team creates or syncs a user. Maya moves from support into platform engineering, and her group memberships and assignments change. A contractor leaves, and disabling the account stops new sign-ins through that identity.

Microsoft Entra ID also supports **guest users** for collaboration. A partner engineer can appear in the DevPolaris tenant as a guest identity while keeping their home identity in another tenant. The Orders team might invite a payments consultant for a two-week dashboard review, and the tenant still keeps a local record for assignments, sign-ins, and cleanup.

Assigning access directly to every person works for a tiny team, and it gets painful as the team grows. The Orders team needs a way to say that support engineers can open the dashboard without copying the same assignment to each individual user. That takes us from users to groups, and the sign-in story also starts caring about devices.

## Groups and Devices
<!-- section-summary: Groups organize shared access for people and devices, while device identities give Conditional Access useful evidence about the machine in use. -->

A **group** is a named collection of users, devices, or other supported members that share an access purpose. In production, groups help teams assign app access, Azure RBAC access, licenses, policy targets, and review ownership. The main idea is simple: manage the team membership, then attach access to the team.

The Orders team creates `grp-orders-support` for support engineers. `orders-admin-web` can require membership in that group, and Azure RBAC can use the same group for Reader access on a support resource group if the team needs it. When Nina joins support, adding Nina to the group gives her the same baseline access as Maya. When Carlos leaves support, removing Carlos from the group removes that shared access path.

Groups also make reviews clearer. A reviewer can ask who owns `grp-orders-support`, why that group has access to the dashboard, and which users belong to it today. That review gives the team one meaningful access object to inspect instead of dozens of separate user assignments that all try to describe the same job.

A **device identity** is a Microsoft Entra ID object for a laptop, desktop, phone, or other device. Device identity gives the sign-in system facts about the machine, such as whether it is registered, joined, managed, or compliant through device management. A support app that handles customer orders can care about those facts because a sign-in from a managed company laptop carries different evidence than a sign-in from an unknown browser on a personal machine.

For `orders-admin-web`, the team might require Maya to use MFA and a compliant company device. Maya's password proves one thing, her group membership proves her job role, and the device record adds another signal about the workstation. Those pieces together make human access feel less like a single password check and more like a full sign-in decision.

People, groups, and devices cover the human side of the Orders system. The running software has its own access problem, because APIs, deployment jobs, background workers, and scripts also need to prove identity without turning every config file into a secret drawer.

## The Software Secret Problem
<!-- section-summary: Software often starts with client secrets, and production teams reduce those secrets because they leak, age, and complicate rotation. -->

A **client secret** is a password-like value that software can present to Microsoft Entra ID while requesting tokens. A developer can create a secret for an app registration, paste it into a web app setting, and make the first version of an integration work. That early convenience explains why secrets appear so often in demos, prototypes, and old production systems.

The problem arrives during operations. Secrets land in CI/CD variables, app settings, password managers, local `.env` files, screenshots, incident notes, and sometimes source control. A leaked secret can keep working until someone rotates or deletes it, and every copy creates another place the team has to inspect during an incident.

The Orders team feels this during the first deployment of `orders-api-prod`. The API needs to read `postgres-password` from Key Vault, and the quick path uses an app credential stored in App Service configuration. The app runs, but the team now owns rotation dates, emergency revoke steps, and questions about who can read or export that setting.

Azure identity gives software better options. **App registrations** describe how software integrates with Microsoft Entra ID. **Service principals** give that software a tenant-local identity that can receive access and appear in logs. **Managed identities** let many Azure-hosted workloads request tokens while Azure manages the underlying credential. **Workload identity federation** can help external systems such as GitHub Actions exchange an external token for an Azure token without storing a client secret.

Those options build on each other, so the next stop is the app registration. The dashboard needs Microsoft sign-in first, and Microsoft Entra ID needs to know what kind of software is asking for that sign-in flow.

## App Registrations
<!-- section-summary: An app registration describes how an application integrates with Microsoft Entra ID, including client ID, tenant behavior, redirect URIs, credentials, scopes, and app roles. -->

An **app registration** is the identity configuration for software in Microsoft Entra ID. When a developer registers an app, Microsoft Entra ID creates an application object that describes how the app can participate in sign-in and token flows. The registration can include a client ID, redirect URIs, supported account types, optional secrets or certificates, API permissions, exposed scopes, app roles, and token settings.

The Orders team registers `orders-admin-web` because the support dashboard needs Microsoft sign-in. The registration gives the team a **client ID**, which is the public identifier the dashboard sends during sign-in. The team also adds a **redirect URI** such as `https://orders-admin.devpolaris.com/auth/callback`, which is the approved callback location where Microsoft Entra ID can send the browser after sign-in.

A simplified web app configuration might look like this. The app team usually stores these values in environment-specific configuration so development, staging, and production can each point at the right tenant, client ID, and callback URL.

```ini
MICROSOFT_ENTRA_TENANT_ID=8f8f2c2a-1111-4444-aaaa-123456789abc
MICROSOFT_ENTRA_CLIENT_ID=0f4c7a29-2222-5555-bbbb-23456789abcd
MICROSOFT_ENTRA_REDIRECT_URI=https://orders-admin.devpolaris.com/auth/callback
```

The tenant ID names the directory that issues tokens. The client ID names the registered application. The redirect URI has to match the registration because the sign-in service only sends responses to approved locations that the app owner configured.

App registrations also shape what an app asks for. If `orders-admin-web` calls a custom `orders-api`, the API can expose scopes such as `Orders.Read` or app roles such as `Orders.SupportAgent`. The dashboard can request those permissions during sign-in, and the API can later inspect the token that targets it.

This is where many learners run into the split between the app registration and the real access object. The app registration describes the software, and the tenant also needs a local principal that can receive permissions, consent, user assignments, and logs. That local principal is the service principal.

## Service Principals
<!-- section-summary: A service principal is the tenant-local identity for an application, and it is the object that receives permissions and appears in operational records. -->

A **service principal** is the local identity for an application in a specific Microsoft Entra tenant. Microsoft describes the application object as the app's template, while the service principal represents that app instance inside a tenant. The service principal is the concrete principal that can receive access, show up under Enterprise applications, appear in sign-in logs, and participate in authorization decisions.

For a single-tenant internal app such as `orders-admin-web`, the app registration and its service principal both live in `devpolaris.com`. For a multitenant SaaS app, the application object may live in the vendor tenant, while every customer tenant gets its own service principal after consent. That local service principal lets each customer tenant manage its own user assignments, policies, and permissions for the same SaaS app.

This split explains a common portal pattern. Developers often use **App registrations** to manage redirect URIs, credentials, exposed APIs, scopes, app roles, and token settings. Operators often use **Enterprise applications** to manage user assignment, consent, sign-in logs, and tenant-local access for the service principal.

A simplified service principal record for the Orders dashboard might look like this. The two IDs appear together often during troubleshooting, so it helps to know which one names the app registration and which one names the tenant-local principal.

```json
{
  "displayName": "orders-admin-web",
  "appId": "0f4c7a29-2222-5555-bbbb-23456789abcd",
  "objectId": "9b7e2a10-3333-6666-cccc-3456789abcde",
  "servicePrincipalType": "Application"
}
```

The `appId` is the client ID from the app registration. The `objectId` names this exact service principal object in this tenant. Azure role assignments, Microsoft Graph queries, audit logs, and troubleshooting screens often care about the object ID because that is the specific principal receiving access.

Service principals give software a proper identity, and they can still use secrets or certificates. The Orders API runs inside Azure, so it can use a stronger pattern for many Azure-to-Azure calls. Azure can create and protect the workload identity, and the app can ask for tokens through the hosting environment.

## Managed Identities
<!-- section-summary: A managed identity gives an Azure resource a Microsoft Entra identity whose credential lifecycle Azure manages for the workload. -->

A **managed identity** is a Microsoft Entra identity that Azure manages for an Azure resource. The workload can request Microsoft Entra tokens through its hosting environment, and Azure handles the underlying credential work. Microsoft describes managed identities as a way for applications to access resources that support Microsoft Entra authentication without developers managing credentials in code.

There are two common managed identity types. A **system-assigned managed identity** belongs to one Azure resource, such as one App Service or one virtual machine, and Azure ties its lifecycle to that resource. A **user-assigned managed identity** is a standalone Azure resource that can attach to multiple workloads, which helps when several apps need the same identity or when the identity should outlive one compute resource.

The Orders API uses a managed identity named `mi-orders-api-prod` to read secrets from `kv-orders-prod`. In application code, the developer can use the Azure SDK credential chain, and the SDK can ask the hosting environment for a token. The code carries the vault URL and the Azure credential path, while Azure supplies the managed identity token.

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const credential = new DefaultAzureCredential();
const vaultUrl = "https://kv-orders-prod.vault.azure.net";
const client = new SecretClient(vaultUrl, credential);

const secret = await client.getSecret("postgres-password");
```

`DefaultAzureCredential` can use the managed identity in Azure hosting environments that support it. The app still needs permission on the vault, so identity and authorization stay as two separate steps. Microsoft Entra ID can issue a token for `mi-orders-api-prod`, and Key Vault still checks whether that identity has a role such as Key Vault Secrets User at the right scope.

Managed identities appear as service principals in the tenant, but Azure owns their credential lifecycle. The team can grant access to the managed identity, monitor its sign-ins, and remove its role assignments. Azure handles the secret material behind the token path, which removes a large chunk of rotation and leak risk for Azure-hosted workloads.

The deployment pipeline has a related need, and it might run outside Azure. **Workload identity federation** lets external software prove itself with a short-lived token from a trusted identity provider, then exchange that proof for a Microsoft Entra access token. In the Orders setup, GitHub Actions can receive an OIDC token from GitHub, present it to Microsoft Entra ID, and receive an Azure token for the deployment identity.

The trust is specific. The identity team configures a federated credential on the application or managed identity that names the trusted issuer, subject, and audience. For GitHub Actions, the issuer is GitHub's OIDC issuer, the subject can narrow trust to a repository, branch, tag, or environment, and the audience usually targets Azure token exchange. When those values match the incoming workflow token, Microsoft Entra ID can issue an Azure access token for the configured identity.

That gives the Orders pipeline a secretless deployment path. The team reviews the GitHub repository and environment rules, the federated credential subject, and the Azure RBAC role assignments for the deployment identity. A production pipeline can then deploy `rg-orders-prod` with a narrow role assignment while avoiding a long-lived client secret in CI variables.

Now the Orders team has identities for people, software, Azure workloads, and external automation. The next piece is the proof they carry during a real request, because Azure services and apps need something safer than a password on every call.

## Tokens and Claims
<!-- section-summary: Microsoft Entra ID issues signed tokens that carry claims, and APIs validate those tokens before making authorization decisions. -->

A **token** is signed data issued by Microsoft Entra ID after a successful authentication and policy process. A token contains **claims**, which are facts about the caller, the tenant, the issuing authority, the target audience, the app, scopes, roles, timestamps, and authentication details. Tokens let apps and Azure services receive proof about a caller without handling the caller's password or long-lived secret on every request.

An **ID token** helps a client application know who signed in. `orders-admin-web` can use an ID token to create Maya's application session after Microsoft sign-in. An **access token** targets a resource or API, and the resource validates the token before using it for authorization. Microsoft guidance says client applications should treat access tokens as opaque strings because the resource API owns the token contents and validation rules.

The browser sign-in flow for the dashboard has several steps. Maya opens `orders-admin-web`, the dashboard sends her browser to Microsoft Entra ID with the client ID, tenant, requested permissions, and redirect URI, and Microsoft Entra ID authenticates her. Conditional Access can require MFA or a compliant device before the app receives the authorization response and exchanges it for tokens.

![Sign-in and token path showing Maya's browser, orders-admin-web, Microsoft Entra ID, the registered redirect URI, orders-api, and token claim checks](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-microsoft-entra-id/sign-in-token-path.png)

*The token path shows the handoff from browser sign-in to API authorization: Entra ID issues signed tokens, and the API validates audience, issuer, scope, role, and expiry claims before trusting the request.*

The managed identity path uses the same token idea with a different caller. `orders-api-prod` asks its Azure hosting environment for a token that targets Key Vault. Microsoft Entra ID issues an access token for the managed identity, and Key Vault validates that token before checking Azure RBAC permissions on the vault.

A small decoded token shape can help make the claim names less mysterious. This example is simplified, and real tokens include more fields. The important part is the relationship between the tenant, audience, caller object, app, scopes, and roles.

```json
{
  "iss": "https://login.microsoftonline.com/8f8f2c2a-1111-4444-aaaa-123456789abc/v2.0",
  "aud": "api://orders-api-prod",
  "tid": "8f8f2c2a-1111-4444-aaaa-123456789abc",
  "oid": "4d9b5d64-7777-8888-dddd-456789abcdef",
  "azp": "0f4c7a29-2222-5555-bbbb-23456789abcd",
  "scp": "Orders.Read",
  "roles": ["Orders.SupportAgent"]
}
```

The `aud` claim names the API that should accept the token. The `tid` claim names the tenant. The `oid` claim names the user or service principal object in that tenant. The `azp` claim can identify the authorized party, and scopes or roles can feed the API's own authorization checks.

Tokens give apps and Azure services signed proof, but the sign-in service still needs to decide whether to issue them in the first place. That is where Conditional Access enters the Orders story, because the company's policy may require more evidence than a password and group membership.

## Conditional Access
<!-- section-summary: Conditional Access combines signals such as user, app, device, location, and risk, then applies controls such as MFA or compliant-device requirements. -->

**Conditional Access** is the Microsoft Entra policy engine for access decisions during sign-in. It combines signals such as user, group, device, location, application, client type, and risk. It can then require controls such as multifactor authentication, a compliant device, a password change, approved client apps, session limits, or a block decision.

The Orders team creates a policy for the support dashboard because the dashboard touches customer data. Members of `grp-orders-support` can open `orders-admin-web` after MFA, and sensitive actions require a compliant company device. A sign-in from an unmanaged laptop can fail or require a stronger control before the dashboard receives useful tokens.

The basic shape of a policy sounds like an if-and-then decision, and the portal gives admins more detailed switches for assignments, conditions, controls, and session rules. A beginner-friendly view might look like this, with each row connecting a sign-in signal to the control the team wants to apply.

| Matching signal | Control applied |
|---|---|
| User belongs to `grp-orders-support` and opens `orders-admin-web` | Require MFA |
| Same user opens the dashboard from an unmanaged device | Require a compliant device |
| Sign-in risk appears high | Require stronger verification or block access |
| Emergency access account signs in | Allow through a planned exception and alert the security team |

**MFA**, or multifactor authentication, means the user supplies another proof beyond the password. That proof might be a passkey, hardware security key, authenticator prompt, or one-time code. For a production support app, MFA helps reduce the chance that a stolen password opens a full working dashboard session.

Conditional Access also needs operational discipline. Teams usually test new policies in report-only mode, exclude carefully controlled emergency access accounts, and inspect sign-in logs after a confusing prompt or block. The policy gives the organization control, and the logs give the team evidence about which signals and controls affected a sign-in.

At this point the Orders team can identify Maya, check her group, evaluate her device, require MFA, and issue tokens. The remaining access question moves to authorization, because a token that proves Maya signed in still has to meet a permission rule before she can view production data or change Azure resources.

## Roles and Authorization
<!-- section-summary: Microsoft Entra ID authenticates callers, while Microsoft Entra roles, Azure RBAC, and application roles decide different kinds of authorization. -->

**Authorization** means deciding what an authenticated caller may do. Maya may sign in successfully, `orders-admin-web` may receive tokens successfully, and `orders-api-prod` may obtain a managed identity token successfully. Those proofs identify the callers, and separate authorization systems decide which directory settings, Azure resources, or app features each caller can use.

**Microsoft Entra roles** control administrative actions inside the directory. A User Administrator can manage users. An Application Administrator can manage app registrations and enterprise applications. A Global Administrator has broad directory power, so production teams limit it, monitor it, and review it closely.

**Azure RBAC** controls access to Azure resources. A role assignment connects a principal, a role definition, and a scope. The principal can be a user, group, service principal, managed identity, or workload identity. The role defines allowed actions, and the scope can be a management group, subscription, resource group, or individual resource.

The Orders API might receive this role assignment so it can read secrets from one Key Vault. The payload is simplified, but the three important parts are still the principal, the role, and the scope.

```json
{
  "principal": "mi-orders-api-prod",
  "principalType": "ServicePrincipal",
  "role": "Key Vault Secrets User",
  "scope": "/subscriptions/sub-orders-prod/resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod"
}
```

This assignment gives one managed identity secret-read access at one vault scope. Microsoft Entra ID owns the identity and token issuance for `mi-orders-api-prod`. Azure RBAC owns the resource permission binding. Key Vault only returns the secret after the token and the role assignment line up.

Applications can add their own authorization too. `orders-admin-web` might receive a token for Maya and then check for an app role such as `Orders.SupportAgent` before showing support tools. A smaller app role such as `Orders.Viewer` might allow customer lookup while keeping refund overrides hidden.

This separation explains many support tickets. Maya can pass Conditional Access and still lack Reader on `rg-orders-prod`. The deployment service principal can have Contributor on one resource group and still lack permission to edit app registrations. The managed identity can authenticate successfully and still receive an authorization error from Key Vault until Azure RBAC grants the right data-plane role.

Roles make access explicit, and explicit access changes constantly as people join, apps ship, and incidents happen. The team needs evidence so every "why was this allowed" or "why was this denied" question can turn into records instead of guessing.

## Evidence and Operations
<!-- section-summary: Sign-in logs, audit logs, service principal records, and Azure activity records help teams explain access decisions after they happen. -->

Identity work needs evidence because production problems rarely arrive as tidy diagrams. Maya gets blocked from the support dashboard. A deployment pipeline receives `AuthorizationFailed`. A security analyst asks who added a client secret. A reviewer asks why a service principal has a privileged directory role.

**Sign-in logs** show authentication activity. They help the team answer who signed in, which app the caller tried to use, which Conditional Access policies applied, whether MFA happened, which device or location appeared, and why the sign-in succeeded or failed. For the Orders dashboard, sign-in logs can explain whether Maya failed MFA, used an unmanaged device, or hit a policy exception.

**Audit logs** show changes inside Microsoft Entra ID. They capture changes to users, groups, applications, service principals, roles, policies, and many other directory objects. If someone added a redirect URI to `orders-admin-web` or created a new client secret, audit logs give the team a place to see the change event and the actor.

Azure adds its own activity and resource logs for the resource side of the story. If `orders-api-prod` receives a Key Vault denial, the team may need the managed identity sign-in record, the Azure role assignment state, and the Key Vault or Azure activity record. One record proves the identity request, and another record explains the resource authorization result.

The Orders team can keep investigations clear by naming four things for every access question. This gives engineers, security reviewers, and app developers the same starting point before they open logs in different tools.

| Investigation question | Orders example |
|---|---|
| Who or what called? | Maya's user object, `orders-admin-web` service principal, or `mi-orders-api-prod` managed identity |
| Which app or resource was targeted? | `orders-admin-web`, `orders-api`, `kv-orders-prod`, or `rg-orders-prod` |
| Which policy or role mattered? | Conditional Access policy, app role, Microsoft Entra role, or Azure RBAC assignment |
| What record explains the result? | Sign-in log, audit log, Azure activity log, resource log, or application log |

This evidence habit connects the whole identity system back to daily operations. The team can follow the request from user or workload identity, through policy, into tokens, across authorization, and into the target resource. That gives the team a practical way to debug access without mixing every identity concept into one vague permission problem.

Now the article has all the pieces. The final section connects the Orders team's human path, runtime path, and deployment path so the full Microsoft Entra ID story sits in one production picture.

## Putting It All Together
<!-- section-summary: Microsoft Entra ID names every caller, evaluates sign-in policy, issues tokens, and hands resource authorization to Azure RBAC or the application layer. -->

The Orders team's Azure identity setup now has a clear shape. The `devpolaris.com` tenant stores people, groups, devices, applications, service principals, managed identities, policies, roles, and logs. Azure subscriptions trust that tenant for identity, and Azure resources use those tenant principals during authorization.

![Microsoft Entra ID summary showing human, runtime, and deployment access paths through the devpolaris.com tenant](/content-assets/articles/article-cloud-providers-azure-identity-security-what-is-microsoft-entra-id/entra-id-summary.png)

*The summary separates the three production paths: Maya's human sign-in, the API's managed identity path, and the deployment pipeline's workload identity path.*

Maya's human path uses several identity pieces together. Her user object lives in the tenant. Her team access comes through `grp-orders-support`. Her laptop gives device evidence. Conditional Access requires MFA and a compliant device before the dashboard receives tokens. The dashboard can then check app roles before showing support actions.

The runtime API path uses a workload version of the same idea. `orders-api-prod` runs with `mi-orders-api-prod`. The Azure SDK asks the hosting environment for a token. Microsoft Entra ID issues the token for the managed identity. Key Vault validates the token and checks Azure RBAC before returning the secret.

The deployment path can use workload identity federation. GitHub Actions proves the workflow identity through a trusted external token. Microsoft Entra ID exchanges that proof for an Azure token, and Azure RBAC decides which resource groups the pipeline can change. The pipeline gets enough access to deploy the Orders app without receiving broad directory power.

Three habits make Microsoft Entra ID practical during real work. First, name the caller precisely as a user, group, device, app registration, service principal, managed identity, or workload identity. Second, separate identity from authorization, because a token proves the caller while roles and app rules decide access. Third, keep evidence close, because sign-in logs, audit logs, Azure activity logs, and app logs explain what happened later.

Microsoft Entra ID is the identity foundation for Azure. It gives people, software, devices, and automation a trusted way to prove who they are. Azure RBAC is the next natural article because it explains how those proven identities receive bounded access to Azure resources.

## What's Next

The next article goes deeper into Azure RBAC. Microsoft Entra ID explains the caller side of the story, and Azure RBAC explains how Azure grants access through principals, role definitions, scopes, role assignments, conditions, deny assignments, and request-time evaluation.

That next step keeps using the same Orders team. Maya, the support dashboard, the deployment pipeline, and the managed identity already have names in the tenant. Azure RBAC decides what each named caller can do inside subscriptions, resource groups, and individual Azure resources.

---

**References**

- [What is Microsoft Entra?](https://learn.microsoft.com/en-us/entra/fundamentals/what-is-entra) - Defines Microsoft Entra ID as the foundational Entra product for cloud identity, authentication, policy enforcement, and protection for users, devices, apps, and resources.
- [New name for Azure Active Directory](https://learn.microsoft.com/en-us/entra/fundamentals/new-name) - Explains the Azure Active Directory to Microsoft Entra ID rename, the timing of the name change, and the continuity of URLs, APIs, tooling, and integrations.
- [Associate or add an Azure subscription to your Microsoft Entra tenant](https://learn.microsoft.com/en-us/entra/fundamentals/how-subscriptions-associated-directory) - Documents the trust relationship between Azure subscriptions and Microsoft Entra tenants, including the one-directory trust rule for subscriptions.
- [How to manage groups](https://learn.microsoft.com/en-us/entra/fundamentals/how-to-manage-groups) - Covers Microsoft Entra groups, membership management, and shared access workflows.
- [What are Microsoft Entra registered devices?](https://learn.microsoft.com/en-us/entra/identity/devices/concept-device-registration) - Explains device identities, registered devices, organizational resource access, and Conditional Access use of device signals.
- [Application and service principal objects in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals) - Defines app registrations, application objects, service principals, Enterprise applications, and managed-identity service principals.
- [What are workload identities?](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-overview) - Defines workload identities, including applications, service principals, managed identities, and workload identity federation scenarios.
- [Managed identities for Azure resources](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) - Explains how managed identities let Azure resources get Microsoft Entra tokens without developers managing credentials.
- [Authenticate Azure-hosted JavaScript apps to Azure resources using a system-assigned managed identity](https://learn.microsoft.com/en-us/azure/developer/javascript/sdk/authentication/system-assigned-managed-identity) - Shows Azure SDK authentication from hosted apps with managed identities and Azure Identity credentials.
- [Access tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) - Explains access tokens, opaque-token guidance for clients, token ownership, claims, audiences, signatures, and validation responsibilities.
- [What is Conditional Access?](https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview) - Describes Conditional Access as the Microsoft Entra policy engine that combines signals and applies controls.
- [Overview of role-based access control in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-overview) - Explains Microsoft Entra roles, role definitions, role assignments, scopes, and the difference between Entra roles and Azure roles.
- [Understand Azure role assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments) - Defines Azure RBAC role assignments through principals, roles, and scopes.
- [Access activity logs in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-access-activity-logs) - Covers sign-in logs, audit logs, provisioning logs, and common monitoring entry points.
