---
title: "Managing Secrets"
description: "Learn where secrets can appear in Terraform and how sensitive, ephemeral, write-only, provider-managed, and reference-based designs reduce exposure."
overview: "Terraform plans changes, passes values through providers, persists state, emits outputs, and commonly runs in CI. This article follows a secret through every boundary and builds a hierarchy from plaintext values to designs where Terraform manages permission without possessing the secret."
tags: ["terraform", "secrets", "sensitive", "ephemeral", "state-security"]
order: 4
id: article-iac-terraform-environments-secrets
---

## Table of Contents

1. [Where Can a Secret Leak Through Terraform?](#where-can-a-secret-leak-through-terraform)
2. [What Does sensitive Protect?](#what-does-sensitive-protect)
3. [How Do Ephemeral and Write-Only Values Reduce Persistence?](#how-do-ephemeral-and-write-only-values-reduce-persistence)
4. [When Should the Provider Service Manage the Secret?](#when-should-the-provider-service-manage-the-secret)
5. [Why Are Secret References Safer Than Secret Values?](#why-are-secret-references-safer-than-secret-values)
6. [How Should Provider and CI Credentials Flow?](#how-should-provider-and-ci-credentials-flow)
7. [Why Are Plans and State Security Boundaries?](#why-are-plans-and-state-security-boundaries)
8. [How Do You Choose the Safest Secret Design?](#how-do-you-choose-the-safest-secret-design)
9. [Check Your Answers](#check-your-answers)

Terraform does more than execute instructions and exit. It evaluates expressions, creates plans, passes arguments to provider plugins, records values in state, exposes outputs, and moves artifacts through CI. Every boundary can expose a secret if the design treats confidential data like an ordinary string.

The small mistake is easy to recognize:

```hcl
resource "example_database" "main" {
  engine   = "postgres"
  username = "admin"
  password = "SuperSecret123!"
}
```

The password now exists in the configuration file, repository history, developer clones, review tools, editor backups, and possibly logs. Moving the text into a variable improves reuse but does not automatically improve secrecy:

```hcl
resource "example_database" "main" {
  engine   = "postgres"
  username = "admin"
  password = var.database_password
}
```

The value still has to originate somewhere and travel into Terraform. It may enter through a `.tfvars` file, environment variable, CI secret, command line, secret manager data source, or generated value. Terraform may then place it in a plan, provider request, state snapshot, output, debug log, or artifact.

Keep these questions in view as you work through the lesson:

1. **Where Can a Secret Leak Through Terraform?**
2. **What Does `sensitive` Protect?**
3. **How Do Ephemeral and Write-Only Values Reduce Persistence?**
4. **When Should the Provider Service Manage the Secret?**
5. **Why Are Secret References Safer Than Secret Values?**
6. **How Should Provider and CI Credentials Flow?**
7. **Why Are Plans and State Security Boundaries?**
8. **How Do You Choose the Safest Secret Design?**

## Where Can a Secret Leak Through Terraform?
<!-- section-summary: Secret review begins by tracing origin, transport, persistence, and consumers rather than focusing only on the source file. -->

Ask four questions for every secret:

| Question | Examples |
|---|---|
| Where does it originate? | Secret manager, CI, user, provider service |
| How does it reach the consumer? | Variable, environment, provider discovery, runtime API |
| Where can it persist? | Git, plan, state, logs, caches, artifacts |
| Who truly needs the value? | Terraform, provider, application, database, operator |

The last question often produces the strongest improvement. If the application needs a database password at runtime, Terraform may not need the plaintext at all. Terraform can create a secret location, grant the application's identity permission, and pass only a reference.

Secret management is therefore an information-flow problem:

```text
secret origin
    -> transport path
    -> systems that see plaintext
    -> persistent copies
    -> final consumer
```

Reduce each arrow and copy. A value that never enters Terraform cannot leak through Terraform state. A short-lived value has less exposure time than a permanent one. A reference reveals location or identity but not the protected content.

## What Does `sensitive` Protect?
<!-- section-summary: sensitive marks presentation so Terraform redacts routine output, but it is not encryption and does not imply that state omits the value. -->

Terraform can mark an input as sensitive:

```hcl
variable "database_password" {
  type      = string
  sensitive = true
}
```

When the value flows into a resource, normal plan and apply output usually redacts it:

```text
password = (sensitive value)
```

This protects against casual disclosure in terminal output and routine CI logs. Sensitivity also propagates through expressions in many cases so a derived value remains redacted.

The crucial distinction is:

```text
sensitive = do not normally display this value

sensitive != do not store this value
sensitive != encrypt this value
sensitive != prevent every command from revealing it
```

Terraform may need the value in state to compare future configuration with the managed object. Marking it sensitive does not change that persistence requirement. Anyone with sufficient state access may still be able to recover it.

Some commands deliberately produce machine-readable information. `terraform output -raw` or `terraform output -json` can expose a sensitive output, and `terraform show -json` can reveal values represented in state or a plan. Redaction is a user-interface behavior, not an authorization boundary around every representation.

`sensitive` is still useful. It states intent, reduces accidental log exposure, and encourages renderers to hide the value. Use it whenever confidential input must pass through Terraform. Just do not stop the threat analysis there.

If a secret has already been committed, adding `sensitive = true` does not erase repository history or revoke the credential. Rotate or invalidate the secret, remove it from active configuration, and handle history according to the repository's incident process.

## How Do Ephemeral and Write-Only Values Reduce Persistence?
<!-- section-summary: Ephemeral values avoid plan and state persistence in allowed contexts, while write-only provider arguments accept a value without reading it back into state. -->

An ephemeral input has a stronger property than a sensitive input:

```hcl
variable "api_token" {
  type      = string
  sensitive = true
  ephemeral = true
}

provider "example" {
  token = var.api_token
}
```

`sensitive` controls normal display. `ephemeral` means Terraform omits the value from plan and state in contexts that support ephemeral data. That reduces persistence, but it also limits where the value can be used. Terraform cannot place a deliberately non-persisted value into an ordinary argument whose future comparison depends on storing it.

```text
sensitive
    presentation property

ephemeral
    persistence property with usage restrictions
```

A write-only provider argument completes the pattern. Historically, a provider argument could be sent to the API and then represented in state. A write-only argument accepts the value for a remote write without returning that value to Terraform's persistent data.

A simplified database example is:

```hcl
resource "aws_db_instance" "main" {
  engine   = "postgres"
  username = "admin"

  password_wo         = var.database_password
  password_wo_version = 1
}
```

The `_wo` field is write-only. The companion version supplies a non-secret change signal. If Terraform does not retain the password, it cannot later compare old and new plaintext to decide whether an update is needed. Incrementing the version tells the provider that the external value should be written again.

An ephemeral resource can create or retrieve a temporary value without persisting it, then feed that value into a supported write-only argument. For example, an ephemeral random password can flow into a database's write-only password input. Terraform coordinates the operation while avoiding a durable plaintext copy in plan or state.

Ephemeral does not mean a value can safely appear anywhere. CI logs, shell tracing, provider debug logs, command arguments, or the remote API can still expose it. The final system must receive the plaintext somewhere. The goal is to narrow the path and remove avoidable persistence, not to claim the value never exists in memory.

## When Should the Provider Service Manage the Secret?
<!-- section-summary: The strongest design often asks the managed service to generate and store its own secret so Terraform handles configuration without seeing plaintext. -->

If a cloud service can generate and manage a credential itself, prefer that over sending a password through Terraform. The current AWS database provider supports a pattern such as:

```hcl
resource "aws_db_instance" "main" {
  engine                      = "postgres"
  username                    = "admin"
  manage_master_user_password = true
}
```

The service generates the password and stores it in its managed secret system. Terraform configures the feature but never needs to supply the plaintext.

Compare the flows:

```text
Terraform-supplied password
    CI/user -> Terraform -> plan/provider/state -> database

service-managed password
    Terraform requests managed secret
    service generates -> secure store -> authorized runtime consumer
```

The second path removes Terraform, the runner, and the plan from the secret's plaintext lifecycle. It also lets the service integrate rotation and storage with its native controls.

Service-managed secrets are not automatically sufficient. Operators still need access policies, rotation behavior, recovery procedures, and an application path for reading the credential. The gain is narrower possession: Terraform manages the capability without becoming a copy of the secret database.

When service-managed generation is unavailable, an ephemeral value plus write-only argument is a strong alternative. When neither is available, a sensitive input may be necessary, and state must be protected as a secret-bearing system. Choose the highest pattern the provider and remote service actually support.

## Why Are Secret References Safer Than Secret Values?
<!-- section-summary: Terraform can manage a secret's container, reference, and access policy while the application retrieves plaintext directly through its runtime identity. -->

Suppose an application needs an API key stored in a secret manager. Reading `secret_string` into Terraform and passing it into another resource gives Terraform possession of the value. A safer boundary is:

```text
Terraform creates or identifies secret container
Terraform grants application identity permission
Terraform passes secret ARN or resource ID
application retrieves plaintext at runtime
```

An ARN, secret name, or resource ID can appear in state without revealing the secret content. Terraform can output that reference:

```hcl
output "secret_arn" {
  description = "Reference read by the application at runtime."
  value       = aws_secretsmanager_secret.api_key.arn
}
```

Terraform can also manage the permission connecting the application identity to that secret. The infrastructure relationship is declarative, reviewable, and auditable, while the application uses its own short-lived runtime credentials to retrieve the content only when needed.

This leads to a useful principle:

> Terraform should often manage permission to possess a secret rather than possess the secret itself.

The application identity becomes the consumer boundary. Cloud audit logs can record secret reads, access can be revoked without changing Terraform source, and rotation does not require a new plan if the stable reference remains the same.

Do not confuse a reference with harmless public data. Secret names and ARNs can reveal system structure, environment, or account information. They still deserve normal infrastructure-data protection, but the impact is much lower than disclosing the plaintext credential.

## How Should Provider and CI Credentials Flow?
<!-- section-summary: Provider credentials should come from short-lived execution identity, and CI should prevent secret values from entering arguments, logs, or durable artifacts. -->

Provider credentials deserve the same “permission, not possession” thinking. Hardcoding cloud keys in a provider block gives Terraform source direct possession of permanent authority. Instead, the execution environment should obtain temporary credentials from an identity system and let the provider discover them.

OIDC-backed automation follows this path:

```text
CI job identity
    -> signed OIDC token
    -> cloud trust policy
    -> temporary role session
    -> provider discovery
    -> API calls
```

Managed Terraform platforms can use dynamic provider credentials through similar OIDC exchanges. The specific platform is less important than the properties: credentials are created for one run, scoped to an approved identity, and discarded or expired afterward.

If a Terraform input secret must enter CI, use the platform's protected secret channel and a supported environment-variable form rather than putting the value directly on a command line. Mark the Terraform variable sensitive and, when its usage supports it, ephemeral. Disable shell tracing around secret-handling steps and avoid printing the environment.

Command-line arguments can appear in process listings and build logs. Temporary `.tfvars` files can remain in workspaces or artifacts. Provider debug logging may include request bodies. Review every delivery mechanism, not just the repository.

CI permissions should separate who can change the workflow, who can release to an environment, and which job can request the deployment identity. A secret store does not help if unreviewed code can simply print its contents. OIDC removes the stored provider key, but protected workflow and environment controls are still necessary.

## Why Are Plans and State Security Boundaries?
<!-- section-summary: Plans and state can contain secret or sensitive infrastructure data, so their storage, access, transport, and retention require explicit controls. -->

A saved plan is executable deployment input and can include values that ordinary terminal rendering hides. JSON plan output can expose sensitive details. Treat plan files as restricted artifacts: limit who can download them, encrypt storage and transport, keep retention as short as the workflow permits, and never publish them in a public build log.

State is a durable record of managed objects and may contain plaintext secret values when provider schemas require them. Store shared state in an appropriately secured remote backend with encryption, access control, locking, versioning or recovery, audit logs, and separation between environments.

```text
developer laptop state
    copied, lost, backed up unpredictably

protected remote state
    centralized access, encryption, locking, recovery, audit
```

Remote storage does not remove the sensitivity; it gives the organization better controls. Limit both human and machine access. A plan role may need to read state, while unrelated application developers may not. Production state should not be broadly readable merely because the repository is widely accessible.

Outputs also deserve review. `sensitive = true` reduces normal display, but consumers with state or explicit raw-output access can retrieve the value. Prefer outputting a secret reference rather than the secret. Remove obsolete secret-bearing outputs and rotate any value that was exposed.

Backups and old state versions remain part of the exposure surface. Rotating the live secret is essential after disclosure, because deleting one visible value does not guarantee all historical copies disappeared.

## How Do You Choose the Safest Secret Design?
<!-- section-summary: Prefer designs that minimize Terraform's possession and persistence of plaintext, then protect every unavoidable boundary. -->

Use this hierarchy from strongest to weakest:

```text
1. service generates and manages the secret
2. application retrieves the secret by reference using runtime identity
3. ephemeral value flows into a write-only argument
4. sensitive value passes through Terraform and protected state
5. plaintext value is embedded in code, files, arguments, or logs
```

Levels can combine. A service may generate a database credential, expose a secret reference, and let an application identity read it at runtime. Terraform manages the database, identity, permission, and reference without learning the password.

For an application with PostgreSQL, the desired model is:

```text
Terraform
    -> creates database with service-managed password
    -> receives or identifies secret reference
    -> grants application identity read permission
    -> configures application with reference only

Application at runtime
    -> authenticates with its workload identity
    -> reads current secret from secret manager
    -> connects to database
```

Before accepting a design, trace the value:

```text
Does plaintext enter source control?
Does Terraform need it, or only the provider or application?
Will it be stored in a plan or state?
Can an ephemeral or write-only interface remove that copy?
Can the remote service generate it instead?
Can the consumer receive a reference and fetch it at runtime?
Who can read plans, state, logs, and old versions?
How is the secret rotated, revoked, and audited?
```

The key lesson is that redaction is only the first layer. Strong secret design reduces possession. The safest Terraform configuration is often the one that creates the secret system and its authorization relationships while leaving the secret value outside Terraform entirely.

Minimize secrets that cross Terraform at all. When a provider can reference an external secret identifier rather than receiving plaintext, state and plan exposure may be reduced. If Terraform must manage the value, assume authorized readers of state can recover it even when CLI output is redacted. Protect backend access, encryption, logs, plan artifacts, variable files, and CI workspaces; use short-lived credentials for the run itself; and rotate any value exposed through history or artifacts rather than only marking it sensitive afterward.

Plan review is part of the secret boundary, not an exception to it. A redacted terminal display does not prove that a saved plan, machine-readable plan output, provider diagnostic, or state snapshot lacks the underlying value. Protect plan artifacts with the same care as state, keep them short-lived, and avoid passing them through broadly readable CI artifacts or chat transcripts.

## Check Your Answers

:::expand[Where Can a Secret Leak Through Terraform?]{kind="recap"}
Trace origin, transport, plaintext consumers, and persistence across code, variables, plans, providers, state, outputs, logs, and CI artifacts.
:::

:::expand[What Does `sensitive` Protect?]{kind="recap"}
`sensitive` redacts routine presentation. It is not encryption, does not imply omission from state, and cannot erase an already exposed credential.
:::

:::expand[How Do Ephemeral and Write-Only Values Reduce Persistence?]{kind="recap"}
Ephemeral values avoid supported plan and state persistence; write-only arguments send values without reading them back. A version field signals later updates.
:::

:::expand[When Should the Provider Service Manage the Secret?]{kind="recap"}
Prefer native service generation and storage when available so Terraform requests the capability without receiving the plaintext credential.
:::

:::expand[Why Are Secret References Safer Than Secret Values?]{kind="recap"}
Terraform can pass a stable ARN or ID and grant runtime access, while the application retrieves plaintext directly through its own identity.
:::

:::expand[How Should Provider and CI Credentials Flow?]{kind="recap"}
Use short-lived execution identities and provider discovery. Protect any unavoidable input secret from command lines, tracing, debug logs, and artifacts.
:::

:::expand[Why Are Plans and State Security Boundaries?]{kind="recap"}
Both can expose sensitive values and infrastructure details. Restrict, encrypt, audit, retain briefly, and protect historical versions and outputs.
:::

:::expand[How Do You Choose the Safest Secret Design?]{kind="recap"}
Prefer service-managed secrets, runtime references, and ephemeral write-only flows before accepting a sensitive value that Terraform must persist.
:::

---

**References**

- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
- [Terraform: Sensitive variables](https://developer.hashicorp.com/terraform/language/values/variables#suppressing-values-in-cli-output)
- [Terraform: Ephemeral values](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral)
- [Terraform: Write-only arguments](https://developer.hashicorp.com/terraform/language/resources/ephemeral/write-only)
- [Terraform CLI: Output](https://developer.hashicorp.com/terraform/cli/commands/output)
- [Terraform CLI: Show](https://developer.hashicorp.com/terraform/cli/commands/show)
- [HCP Terraform: Dynamic provider credentials](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/dynamic-provider-credentials)
