---
title: "Practical: Set Up Azure Identity And Access For A Startup"
description: "Build a startup-style Azure identity setup from zero to launch: tenant, subscriptions, groups, Conditional Access, PIM, app registration, managed identities, RBAC, Key Vault, Azure DevOps federation, and launch evidence."
overview: "This article is written as a direct production walkthrough. We set up Azure identity and access for a startup Orders platform, using real names, real scopes, real commands, and launch evidence. When the walkthrough uses a tutorial shortcut, we call it out and explain the production-grade version."
tags: ["azure", "microsoft-entra-id", "azure-rbac", "managed-identity", "conditional-access", "key-vault", "azure-devops", "security"]
order: 4
id: article-cloud-providers-azure-identity-security-practical-startup-identity-access
aliases:
  - practical-startup-identity-access
  - practical-startup-auth-setup
  - startup-auth-setup
  - practical-azure-identity-access
  - setup-azure-identity-access-startup
  - cloud-providers/azure/identity-security/practical-startup-identity-access.md
---

## Table of Contents

1. [What We Are Building](#what-we-are-building)
2. [Write The Access Workbook First](#write-the-access-workbook-first)
3. [Create The Groups And Azure Boundary](#create-the-groups-and-azure-boundary)
4. [Protect Human Sign-In](#protect-human-sign-in)
5. [Connect The Support Dashboard To Entra ID](#connect-the-support-dashboard-to-entra-id)
6. [Give The Runtime Apps Managed Identities](#give-the-runtime-apps-managed-identities)
7. [Grant Production Permissions](#grant-production-permissions)
8. [Connect Azure DevOps For Deployment](#connect-azure-devops-for-deployment)
9. [Run The Launch Rehearsal](#run-the-launch-rehearsal)
10. [The Final Walkthrough](#the-final-walkthrough)

## What We Are Building
<!-- section-summary: We start with the exact startup system, tenant, subscriptions, apps, identities, and production resources we will configure during the walkthrough. -->

Imagine we are the Azure DevOps engineer at DevPolaris, a startup launching its first production Orders platform. We are presenting the production identity setup to the company, but we are also building it step by step. The goal is simple: by the end, everyone can see who signs in, which identity each app uses, what each identity can touch, and what evidence proves it.

Here is the production shape. We have one Microsoft Entra tenant, one non-production subscription, one production subscription, one production resource group, a support dashboard, an API, a worker, a Key Vault, a Storage account, and an Azure DevOps pipeline.

```yaml
company: DevPolaris
tenant: devpolaris.com
product: Orders
launch_environment: production

subscriptions:
  nonprod: sub-devpolaris-nonprod
  prod: sub-devpolaris-prod

production_resource_group: rg-orders-prod
location: uksouth

applications:
  orders-admin-web:
    host: app-orders-admin-prod
    purpose: internal support dashboard
  orders-api:
    host: ca-orders-api-prod
    purpose: customer order API
  orders-worker:
    host: ca-orders-worker-prod
    purpose: invoice export worker

production_targets:
  key_vault: kv-orders-prod
  export_storage: stordersprodexports
  deployment_service_connection: sc-orders-prod-deploy
```

The rule for the whole walkthrough is this: **every production action needs a caller, a role, a scope, and evidence**. A support engineer opening the dashboard has a caller, a sign-in control, an app assignment, and a sign-in log. The API reading a secret has a caller, a Key Vault role, a vault scope, and a role assignment. The pipeline deploying production has a caller, a deployment role, a resource group scope, and an activity log.

![DevPolaris Orders production access board](/content-assets/articles/article-cloud-providers-azure-identity-security-practical-startup-identity-access/production-access-board.png)

*The production board keeps the setup concrete: identities live in `devpolaris.com`, Azure resources live in subscriptions, and access connects a caller to a role at a scope.*

We also keep Microsoft guidance in mind while we build. Azure RBAC guidance says to grant only the access needed for the job, assign roles to groups where possible, use narrow scopes, and use PIM for privileged access. Key Vault guidance recommends a vault per application per environment with roles assigned at the vault scope. Managed identity guidance recommends user-assigned identities for many app scenarios because their lifecycle is separate from the compute resource. Those rules shape the tutorial.

## Write The Access Workbook First
<!-- section-summary: Before creating Azure permissions, we write a small access workbook that names the real callers, resources, owners, permissions, scopes, and evidence. -->

We start with a file called `orders-production-access.yml`. This is the first artifact because production access should have a written shape before it becomes a portal setting. The file stays small. It names the people, groups, software identities, resources, reasons, and evidence we expect to see later.

The first page is human access. We use groups because a startup changes quickly. New support engineers join, engineers move teams, contractors leave, and direct user assignments become cleanup work. Microsoft Azure RBAC guidance also recommends assigning roles to groups where possible.

```yaml
human_access:
  grp-orders-support:
    owner: maya@devpolaris.com
    members_for_launch:
      - maya@devpolaris.com
      - nina@devpolaris.com
    needs:
      - sign in to orders-admin-web
    optional_needs:
      - read Orders production health during incidents
    evidence:
      - enterprise application assignment
      - Conditional Access sign-in result
      - group membership export

  grp-orders-engineers:
    owner: ava@devpolaris.com
    members_for_launch:
      - ava@devpolaris.com
      - liam@devpolaris.com
      - tom@devpolaris.com
    needs:
      - read production resources
      - read application logs
      - inspect deployment state
    evidence:
      - Azure RBAC assignment list
      - group membership export

  grp-platform-admins:
    owner: priya@devpolaris.com
    members_for_launch:
      - tom@devpolaris.com
      - priya@devpolaris.com
    needs:
      - eligible admin access for production changes
    evidence:
      - PIM eligible assignment
      - PIM activation history
```

Notice the support group's `optional_needs`. In this tutorial, we may give support leads limited Reader access to production resource health so they can help during incidents. In a real production environment, you should only grant that if the support workflow actually needs Azure portal visibility. Many support teams only need the application dashboard and incident status page.

The second page is software access. We separate runtime identity from deployment identity because those jobs are different. The API reads secrets and writes export files. The pipeline deploys resources. If one identity does both jobs, logs become harder to review and permissions become too broad.

```yaml
software_access:
  orders-admin-web:
    identity_type: app_registration
    signs_in: DevPolaris employees
    allowed_group: grp-orders-support
    evidence:
      - app registration
      - enterprise application assignment
      - sign-in log

  mi-orders-api-prod:
    identity_type: user_assigned_managed_identity
    attached_to: ca-orders-api-prod
    needs:
      - read orders-db-password from kv-orders-prod
      - write invoice exports to stordersprodexports
    evidence:
      - managed identity resource
      - Container App identity attachment
      - role assignment list

  mi-orders-worker-prod:
    identity_type: user_assigned_managed_identity
    attached_to: ca-orders-worker-prod
    needs:
      - write invoice export blobs
    evidence:
      - managed identity resource
      - Container App identity attachment
      - role assignment list

  spn-azdo-orders-deploy-prod:
    identity_type: service_principal
    used_by: sc-orders-prod-deploy
    needs:
      - deploy resources in rg-orders-prod
    evidence:
      - Azure DevOps service connection
      - Azure RBAC assignment
      - Azure activity log
```

This workbook changes the access conversation. A vague request like "the API needs Azure access" becomes "`mi-orders-api-prod` needs `Key Vault Secrets User` at `kv-orders-prod` because the API reads `orders-db-password` at runtime." That sentence has a caller, role, scope, and reason, so the team can approve it and test it.

![0 to 1 Azure identity build sequence](/content-assets/articles/article-cloud-providers-azure-identity-security-practical-startup-identity-access/identity-build-sequence.png)

*The build sequence is the runbook: create team groups, create the production boundary, protect sign-in, register the app, attach workload identity, grant RBAC, and rehearse evidence.*

Now we can create the real group and resource boundary. This is the moment where the workbook starts turning into real Azure objects.

## Create The Groups And Azure Boundary
<!-- section-summary: We create Microsoft Entra security groups and the production Azure resource group so every later assignment points at a real team and a real scope. -->

A **Microsoft Entra security group** is a named group of users that can receive app access and Azure role assignments. In plain English, it lets us attach access to a team through one shared object. We create one group for support access, one for engineering visibility, one for deployment approval, and one for people who can activate privileged admin work.

```bash
az ad group create \
  --display-name "grp-orders-support" \
  --mail-nickname "grp-orders-support"

az ad group create \
  --display-name "grp-orders-engineers" \
  --mail-nickname "grp-orders-engineers"

az ad group create \
  --display-name "grp-orders-deploy-approvers" \
  --mail-nickname "grp-orders-deploy-approvers"

az ad group create \
  --display-name "grp-platform-admins" \
  --mail-nickname "grp-platform-admins"
```

The output gives us stable object IDs. We save those IDs because display names are for humans, while object IDs are safer for automation and evidence.

```json
{
  "displayName": "grp-orders-support",
  "id": "group-orders-support-object-id",
  "mailNickname": "grp-orders-support",
  "securityEnabled": true
}
```

Then we add launch members. In a mature company this may come from HR-driven lifecycle automation or identity governance. For this walkthrough, we add the first members directly and record the initial membership in the launch evidence folder.

```bash
az ad group member add \
  --group "grp-orders-support" \
  --member-id "user-maya-object-id"

az ad group member add \
  --group "grp-orders-support" \
  --member-id "user-nina-object-id"
```

Now we create the production Azure boundary. An **Azure subscription** holds Azure resources and billing. A **resource group** is a smaller container for related resources. Azure RBAC can assign roles at management group, subscription, resource group, or resource scope, and the scope matters because it controls how far the permission reaches.

```bash
az account set --subscription sub-devpolaris-prod

az group create \
  --name rg-orders-prod \
  --location uksouth \
  --tags product=orders environment=prod owner=platform
```

The output gives us the real scope string. We copy it into the workbook because later RBAC commands should use this exact production boundary.

```json
{
  "id": "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod",
  "location": "uksouth",
  "name": "rg-orders-prod",
  "tags": {
    "environment": "prod",
    "owner": "platform",
    "product": "orders"
  }
}
```

This is where the production standard matters. Azure RBAC guidance says to grant least privilege and use narrow scopes. If `grp-orders-engineers` gets Reader at the whole production subscription, engineers can see every resource in that subscription. If the group gets Reader at `rg-orders-prod`, engineers can see the Orders production resources only. For this tutorial, the Orders resource group is the working scope.

The groups and resource boundary are ready. Now we protect sign-in before granting useful access.

## Protect Human Sign-In
<!-- section-summary: We add Conditional Access, emergency accounts, and PIM so human access uses MFA, device checks, recovery accounts, and time-bound privileged activation. -->

**Conditional Access** is Microsoft Entra ID's sign-in policy system. It can use signals such as user, group, application, device, location, and risk to require MFA, require a compliant device, block risky paths, or allow a session after controls pass. We use it before production launch because app assignment alone leaves the sign-in path too weak.

We start from a policy worksheet before opening the policy editor. Microsoft recommends planning Conditional Access with test users or groups and report-only mode, then reviewing sign-in logs before broad enforcement.

```yaml
conditional_access_launch:
  require_mfa_for_azure_management:
    users: all employees
    exclude:
      - breakglass-1@devpolaris.com
      - breakglass-2@devpolaris.com
    target: Microsoft Azure Management
    control: require MFA
    rollout: report-only for 3 days, then enabled

  require_managed_device_for_orders_admin:
    users: grp-orders-support
    target: orders-admin-web
    controls:
      - require MFA
      - require compliant device
    rollout: test with Maya and Nina first

  block_legacy_authentication:
    users: all employees
    target: legacy client apps
    control: block
    rollout: report-only, review sign-in logs, then enabled
```

We also create emergency access accounts. Microsoft guidance recommends two or more emergency accounts so the organization can recover access if normal administrator sign-in or role activation breaks. These accounts should be cloud-only, monitored, protected with strong authentication, and reserved for emergency use.

```yaml
emergency_access:
  accounts:
    - breakglass-1@devpolaris.com
    - breakglass-2@devpolaris.com
  controls:
    - excluded from Conditional Access
    - monitored with immediate sign-in alerts
    - protected with phishing-resistant authentication where available
    - credentials stored through the emergency access process
    - reviewed after every use
```

Next we configure privileged access. **Privileged Identity Management**, usually called **PIM**, gives eligible, time-bound access to privileged Microsoft Entra roles and Azure resource roles. A user can activate a role for a limited duration, satisfy MFA, provide a reason, and leave an activation record.

```yaml
pim_launch_plan:
  tom@devpolaris.com:
    eligible_roles:
      - User Access Administrator at sub-devpolaris-prod
      - Key Vault Data Access Administrator at kv-orders-prod
    maximum_duration: 1 hour
    approval: priya@devpolaris.com

  priya@devpolaris.com:
    eligible_roles:
      - Conditional Access Administrator
      - Privileged Role Administrator
    maximum_duration: 1 hour
    approval: CTO

  emergency_owner_access:
    eligible_users:
      - tom@devpolaris.com
      - priya@devpolaris.com
    role: Owner at sub-devpolaris-prod
    maximum_duration: 30 minutes
    approval: CTO
```

For production, keep privileged roles rare and time-bound. Azure RBAC guidance specifically calls out PIM for just-in-time privileged access, narrow scopes for privileged administrator roles, and a low number of subscription owners. In this walkthrough, daily work happens through normal groups, while privileged changes go through PIM.

Human sign-in and admin access now have controls. Next we connect the support dashboard to Microsoft Entra ID.

## Connect The Support Dashboard To Entra ID
<!-- section-summary: We register the support dashboard, assign the support group, configure redirect URIs, and show how the app checks access after sign-in. -->

An **app registration** is the Microsoft Entra record that describes how an application signs users in. It contains a client ID, redirect URIs, supported account type, app roles, scopes, and optional credentials. The related **service principal** is the tenant-local identity for that app, and it appears under Enterprise applications for assignment, consent, sign-in logs, and review.

We create an app registration called `orders-admin-web`. The app is single-tenant because only DevPolaris employees sign in. We enable assignment required on the Enterprise application and assign `grp-orders-support`.

```yaml
app_registration:
  display_name: orders-admin-web
  supported_account_types: single_tenant
  redirect_uris:
    - https://orders-admin.devpolaris.com/auth/callback
    - https://orders-admin-staging.devpolaris.com/auth/callback
  enterprise_application:
    assignment_required: true
    assigned_groups:
      - grp-orders-support
```

The application receives the tenant, client, and redirect values through configuration. This is an interactive user sign-in flow, so this tutorial path uses tenant, client, and redirect configuration with no long-lived client secret.

```ini
MICROSOFT_ENTRA_TENANT_ID=tenant-devpolaris
MICROSOFT_ENTRA_CLIENT_ID=client-orders-admin-web
MICROSOFT_ENTRA_REDIRECT_URI=https://orders-admin.devpolaris.com/auth/callback
```

Now the app needs its own authorization check after Microsoft Entra ID signs the user in. For the tutorial, we show a group check because it is easy to see. In production, app roles can be cleaner for application authorization, especially when group claims become large or when the app wants business-focused roles like `Orders.SupportAgent`.

```ts
type SignedInUser = {
  objectId: string;
  email: string;
  groups: string[];
};

const ORDERS_SUPPORT_GROUP_ID = "group-orders-support-object-id";

export function canOpenOrdersAdmin(user: SignedInUser): boolean {
  return user.groups.includes(ORDERS_SUPPORT_GROUP_ID);
}
```

The support flow now looks like this. Maya opens `orders-admin-web`, Microsoft Entra ID requires MFA, Conditional Access checks her device, Enterprise applications confirms the support group assignment, and the dashboard checks access before showing customer orders. The evidence lives in sign-in logs, Enterprise application assignment, and application audit logs.

The human-facing app is ready. Now we set up the runtime apps.

## Give The Runtime Apps Managed Identities
<!-- section-summary: We create user-assigned managed identities for the API and worker so Azure can issue runtime tokens through Azure-managed identity paths. -->

A **managed identity** is a Microsoft Entra identity attached to an Azure resource. The running workload asks Azure for a token through the hosting environment, and Azure manages the credential behind that path. Microsoft describes managed identities as a way for Azure resources to access services that support Microsoft Entra authentication while Azure handles the credential lifecycle.

We use user-assigned managed identities for the API and worker. A **user-assigned managed identity** is its own Azure resource, so its lifecycle is separate from the compute resource. Microsoft managed identity guidance says user-assigned identities are more efficient across a broader range of scenarios, especially when you want separate identity administration and resource creation.

```bash
az identity create \
  --name mi-orders-api-prod \
  --resource-group rg-orders-prod \
  --location uksouth \
  --tags product=orders environment=prod owner=platform
```

The output gives us two important values. The `clientId` helps application code select this managed identity. The `principalId` receives Azure RBAC assignments.

```json
{
  "name": "mi-orders-api-prod",
  "clientId": "client-mi-orders-api-prod",
  "principalId": "principal-mi-orders-api-prod",
  "id": "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod"
}
```

We record both managed identities in the workbook. Keeping client IDs and principal IDs next to the workload names makes later RBAC checks much easier to follow.

```yaml
managed_identities:
  mi-orders-api-prod:
    client_id: client-mi-orders-api-prod
    principal_id: principal-mi-orders-api-prod
    attached_to: ca-orders-api-prod
    job: read Key Vault secret and write export blobs

  mi-orders-worker-prod:
    client_id: client-mi-orders-worker-prod
    principal_id: principal-mi-orders-worker-prod
    attached_to: ca-orders-worker-prod
    job: write invoice export blobs
```

Then we attach the API identity to the Container App. This creates the runtime token path.

```bash
az containerapp identity assign \
  --name ca-orders-api-prod \
  --resource-group rg-orders-prod \
  --user-assigned "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod"
```

The application code uses the Azure SDK credential chain. In production, `AZURE_CLIENT_ID` selects `mi-orders-api-prod`. The code carries the vault URL and identity client ID, while Azure provides the credential path.

```ts
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID,
});

const secrets = new SecretClient(
  "https://kv-orders-prod.vault.azure.net",
  credential
);

const databasePassword = await secrets.getSecret("orders-db-password");
```

At this point the API has identity, but it still needs authorization. Microsoft Entra ID can issue a token for `mi-orders-api-prod`; Azure RBAC decides whether that identity can read the Key Vault secret or write blobs.

## Grant Production Permissions
<!-- section-summary: We grant Azure RBAC roles at the Key Vault and Storage scopes, keep tutorial shortcuts explicit, and store remaining secrets in a per-app production vault. -->

**Azure RBAC** is Azure's authorization system for Azure resources. A role assignment connects a **principal**, a **role**, and a **scope**. The principal is the caller, the role is the permission bundle, and the scope is where the permission applies. For production, Microsoft guidance says to grant least privilege and use narrow scopes.

Here are the runtime role assignments we create. The API and worker get separate rows because each runtime job needs its own evidence.

```yaml
api_runtime_rbac:
  - principal: mi-orders-api-prod
    principal_id: principal-mi-orders-api-prod
    role: Key Vault Secrets User
    scope: /subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod
    reason: API reads orders-db-password at runtime

  - principal: mi-orders-api-prod
    principal_id: principal-mi-orders-api-prod
    role: Storage Blob Data Contributor
    scope: /subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports
    reason: API writes invoice export files

worker_runtime_rbac:
  - principal: mi-orders-worker-prod
    principal_id: principal-mi-orders-worker-prod
    role: Storage Blob Data Contributor
    scope: /subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports
    reason: worker writes invoice export files
```

We create the Key Vault assignment for the API identity. This is the permission that lets the runtime read the database password from the production vault.

```bash
az role assignment create \
  --assignee-object-id principal-mi-orders-api-prod \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod"
```

The output becomes evidence. We keep the principal, role, and scope together so the launch reviewer can compare it with the workbook.

```json
{
  "principalId": "principal-mi-orders-api-prod",
  "principalType": "ServicePrincipal",
  "roleDefinitionName": "Key Vault Secrets User",
  "scope": "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod"
}
```

Then we create the Storage assignment. This covers blob writes, which is a different production action from reading a secret value.

```bash
az role assignment create \
  --assignee-object-id principal-mi-orders-api-prod \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports"
```

For production automation, use role IDs because Microsoft notes that role names can change. We show role names in the tutorial so the permission is readable, and the production script should resolve or pin the role definition ID.

Now we create the vault. **Azure Key Vault** stores secrets, keys, and certificates. Key Vault guidance recommends a vault per application per environment, with roles assigned at the vault scope. We follow that pattern with `kv-orders-prod`.

```bash
az keyvault create \
  --name kv-orders-prod \
  --resource-group rg-orders-prod \
  --location uksouth \
  --enable-rbac-authorization true \
  --tags product=orders environment=prod owner=platform
```

Key Vault has a **control plane** and a **data plane**. The control plane manages the vault resource. The data plane reads and writes secrets, keys, and certificates. Microsoft documents that `Key Vault Contributor` manages the vault resource and grants no access to secret contents, while data roles such as `Key Vault Secrets User` cover secret value access when the vault uses Azure RBAC.

```yaml
key_vault_access:
  vault: kv-orders-prod

  runtime_secret_read:
    principal: mi-orders-api-prod
    role: Key Vault Secrets User
    reason: read database password at runtime

  vault_metadata_read:
    principal: grp-orders-engineers
    role: Key Vault Reader
    reason: inspect vault and secret metadata during incidents

  data_access_admin:
    principal: priya@devpolaris.com
    role: Key Vault Data Access Administrator
    path: activate through PIM
    reason: manage Key Vault data-plane role assignments during approved work
```

Then we set the first secret. In a real production environment, the value should come from a controlled handoff or secret provisioning process. In this tutorial, we hide the value and show the command shape.

```bash
az keyvault secret set \
  --vault-name kv-orders-prod \
  --name orders-db-password \
  --value "hidden-in-demo"
```

The useful output is metadata. The secret value stays out of screenshots, tickets, and launch notes.

```json
{
  "id": "https://kv-orders-prod.vault.azure.net/secrets/orders-db-password/version-id",
  "name": "orders-db-password",
  "attributes": {
    "enabled": true
  }
}
```

The runtime side now has identity, permission, and a target secret. The final production caller is Azure DevOps.

## Connect Azure DevOps For Deployment
<!-- section-summary: We connect Azure DevOps through workload identity federation, scope deployment access to the production resource group, and call out the tutorial bootstrap role. -->

An **Azure DevOps service connection** lets a pipeline authenticate to Azure. We create an Azure Resource Manager service connection named `sc-orders-prod-deploy`. The service connection uses **workload identity federation**, which lets Azure DevOps exchange trusted pipeline identity proof for a Microsoft Entra token. Azure DevOps documentation recommends workload identity federation for app registration connections, and it removes the stored service principal secret from the pipeline setup.

```yaml
azure_devops_service_connection:
  name: sc-orders-prod-deploy
  type: Azure Resource Manager
  authentication: workload identity federation
  service_principal: spn-azdo-orders-deploy-prod
  subscription: sub-devpolaris-prod
  deployment_scope: rg-orders-prod
```

For this tutorial, we show a common bootstrap choice: `Contributor` at the Orders production resource group. This is still scoped to `rg-orders-prod`, so it cannot deploy across the whole subscription. The production standard is stricter. After you know the actual deployment operations, replace this with a custom deployment role that lists explicit actions and avoids wildcards, because Azure RBAC guidance recommends least privilege and explicit permissions for custom roles.

```bash
az role assignment create \
  --assignee-object-id principal-spn-azdo-orders-deploy-prod \
  --assignee-principal-type ServicePrincipal \
  --role "Contributor" \
  --scope "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod"
```

The pipeline references the service connection by name. Azure DevOps handles the federated token exchange behind the task.

```yaml
trigger:
  branches:
    include:
      - main

stages:
  - stage: DeployProduction
    displayName: Deploy Orders Production
    jobs:
      - deployment: deploy_orders_prod
        environment: orders-prod
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureCLI@2
                  displayName: Deploy Bicep
                  inputs:
                    azureSubscription: sc-orders-prod-deploy
                    scriptType: bash
                    scriptLocation: inlineScript
                    inlineScript: |
                      az deployment group create \
                        --resource-group rg-orders-prod \
                        --template-file infra/main.bicep \
                        --parameters environment=prod
```

Now deployment has its own caller. Runtime API access comes from `mi-orders-api-prod`. Deployment access comes from `spn-azdo-orders-deploy-prod`. Human support access comes from Maya through `grp-orders-support`. The activity log can tell those jobs apart.

## Run The Launch Rehearsal
<!-- section-summary: We prove each access path with sign-in logs, app assignments, identity attachment, RBAC output, pipeline evidence, activity logs, and one intentional failure. -->

The launch rehearsal is where the setup becomes real. We take each access path, run the check, show expected output, and store the evidence. This keeps the walkthrough close to a company presentation because we are testing the actual production paths the team will use.

The first test is support dashboard sign-in. Maya signs in from a company laptop. The expected result is a chain of evidence.

```yaml
test: support_dashboard_sign_in
caller: maya@devpolaris.com
group: grp-orders-support
device: compliant company laptop
expected_result:
  - MFA required
  - compliant device accepted
  - orders-admin-web opens
  - application confirms support access
evidence:
  - Microsoft Entra sign-in log
  - Conditional Access result
  - Enterprise application assignment
  - application audit log with Maya's object ID
```

The second test is API identity attachment. We confirm the Container App has `mi-orders-api-prod` attached.

```bash
az containerapp identity show \
  --name ca-orders-api-prod \
  --resource-group rg-orders-prod
```

The output should show the user-assigned identity, client ID, and principal ID from the workbook. Those fields prove that the running app uses the intended workload identity.

```json
{
  "userAssignedIdentities": {
    "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod": {
      "clientId": "client-mi-orders-api-prod",
      "principalId": "principal-mi-orders-api-prod"
    }
  }
}
```

The third test is API authorization. We list role assignments for the managed identity principal.

```bash
az role assignment list \
  --assignee principal-mi-orders-api-prod \
  --all \
  --query "[].{role:roleDefinitionName, scope:scope}"
```

The output should show the two runtime roles. Those rows prove that the managed identity can read the vault secret and write export blobs.

```json
[
  {
    "role": "Key Vault Secrets User",
    "scope": "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod"
  },
  {
    "role": "Storage Blob Data Contributor",
    "scope": "/subscriptions/sub-devpolaris-prod/resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports"
  }
]
```

The fourth test is pipeline deployment. The pipeline should authenticate through the service connection, deploy to `rg-orders-prod`, and leave Azure activity evidence under `spn-azdo-orders-deploy-prod`.

```yaml
test: production_pipeline_deploy
caller: spn-azdo-orders-deploy-prod
service_connection: sc-orders-prod-deploy
expected_result:
  - pipeline authenticates through workload identity federation
  - deployment updates rg-orders-prod
  - Azure activity log names the deployment service principal
evidence:
  - Azure DevOps run
  - deployment operation output
  - Azure activity log
```

The fifth test is an intentional failure in non-production. We remove `Storage Blob Data Contributor` from a test managed identity and run the export job. The expected failure should name an authorization problem for the identity and the blob write action. This gives engineers a safe way to practice reading production access failures.

```yaml
failure_drill:
  caller: mi-orders-api-test
  missing_role: Storage Blob Data Contributor
  expected_error: authorization failure on blob write
  lesson:
    - identity attachment and RBAC assignment are both required
    - RBAC assignment must match the target action and scope
    - logs should point to the workload identity that made the request
```

The launch evidence folder now has real records. We keep this list small enough that the team can collect it during every release review.

```yaml
launch_evidence_pack:
  - group membership export for Orders groups
  - Conditional Access sign-in result for Maya
  - Enterprise application assignment for orders-admin-web
  - PIM activation test for production access administration
  - managed identity attachment output for ca-orders-api-prod
  - role assignment list for mi-orders-api-prod
  - Key Vault secret read test from the API
  - Azure DevOps production deployment run
  - Azure activity log showing spn-azdo-orders-deploy-prod
  - non-production failure drill notes
```

This rehearsal is the practical heart of the setup. We can explain who made each production request, which role allowed it, which scope contained it, and which evidence proves it.

## The Final Walkthrough
<!-- section-summary: The final picture ties the production setup together as three access paths: support engineer, runtime API, and deployment pipeline. -->

Now we can walk through one normal production day. Maya signs in to `orders-admin-web` from a managed laptop. Microsoft Entra ID requires MFA and checks the device. Enterprise application assignment allows `grp-orders-support`, and the dashboard checks support access before showing customer orders.

The Orders API runs as `ca-orders-api-prod` with `mi-orders-api-prod` attached. The code asks Azure for a token using the managed identity client ID. Key Vault accepts the token because Azure RBAC grants `Key Vault Secrets User` at `kv-orders-prod`. Storage accepts invoice export writes because Azure RBAC grants `Storage Blob Data Contributor` at `stordersprodexports`.

Azure DevOps deploys through `sc-orders-prod-deploy`. The service connection uses workload identity federation, and the Azure request comes from `spn-azdo-orders-deploy-prod`. The role assignment gives that service principal deployment access at `rg-orders-prod`. The activity log names the pipeline identity, so a reviewer can separate deployment activity from runtime API activity and human support activity.

![Three production access paths](/content-assets/articles/article-cloud-providers-azure-identity-security-practical-startup-identity-access/production-access-paths.png)

*The final production view separates the three daily paths: support engineers sign in through Conditional Access, the API uses managed identity for Key Vault and Storage, and Azure DevOps deploys through a federated service connection.*

Privileged access sits outside daily work. If we need to change a production role assignment, we activate User Access Administrator through PIM, give a reason, receive approval, make the change, and leave activation evidence. If a Conditional Access policy blocks normal administration, emergency accounts give the company a monitored recovery path.

The final review table stays short because the setup is testable. Each question points to one place the team can inspect during onboarding, incident response, or audit review.

| Production question | Where the answer lives |
|---|---|
| Who can use the support dashboard? | Enterprise application assignment and `grp-orders-support` membership |
| Which sign-in controls protected the session? | Conditional Access sign-in log |
| Which identity does the API use? | Container App identity attachment for `mi-orders-api-prod` |
| Who can read secret values? | Key Vault data-plane RBAC assignments |
| Who writes export blobs? | Storage Blob Data Contributor assignments |
| Who deploys production? | Azure DevOps service connection and Azure activity log |
| Who can grant access? | PIM eligible assignments and activation history |
| What happens during lockout? | Emergency account process and sign-in alerts |

This is the full 0-to-1 identity setup. We created named groups, a production scope, sign-in controls, emergency access, time-bound admin access, a support app registration, managed identities, Key Vault data roles, a federated deployment service connection, and launch evidence. The setup still fits a startup, and it follows the production direction Microsoft recommends: least privilege, group-based assignments, narrow scopes, managed identities, PIM, and tested Conditional Access rollout.

---

**References**

- [Best practices for Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/best-practices)
- [Understand Azure role assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments)
- [Plan a Conditional Access deployment](https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan-conditional-access)
- [Manage emergency access accounts in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access)
- [Start using Privileged Identity Management](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-getting-started)
- [Managed identity best practice recommendations](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations)
- [Provide access to Key Vault with Azure RBAC](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [Troubleshoot Azure Resource Manager service connections](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/azure-rm-endpoint?view=azure-devops)
- [Automate Azure Resource Manager service connections with workload identity](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/automate-service-connections?view=azure-devops)
