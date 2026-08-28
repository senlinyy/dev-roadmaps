---
title: "File Layout and Environment Isolation"
description: "Learn how Terraform directories, state, backends, credentials, root modules, and shared modules combine into safe environment boundaries."
overview: "Terraform executes a directory as one root configuration and state defines its ownership. This article derives a practical live/modules repository, explains what belongs in each layer, and shows why production isolation needs aligned directories, state, accounts, credentials, variables, and approval."
tags: ["terraform", "file-layout", "environments", "state-isolation", "modules"]
order: 2
id: article-iac-terraform-environments-file-layout
---

## Table of Contents

1. [What Does Terraform Execute in a Directory?](#what-does-terraform-execute-in-a-directory)
2. [How Do State and Backends Define Ownership?](#how-do-state-and-backends-define-ownership)
3. [Why Does Layout Strengthen Environment Isolation?](#why-does-layout-strengthen-environment-isolation)
4. [How Does a live/modules Repository Work?](#how-does-a-livemodules-repository-work)
5. [What Belongs in Root and Shared Module Folders?](#what-belongs-in-root-and-shared-module-folders)
6. [How Fine-Grained Should Deployment Roots Become?](#how-fine-grained-should-deployment-roots-become)
7. [How Do Initialization and Planning Prove the Target?](#how-do-initialization-and-planning-prove-the-target)
8. [Which Layout Rules Remain Useful as Systems Grow?](#which-layout-rules-remain-useful-as-systems-grow)
9. [Check Your Answers](#check-your-answers)

Terraform file layout is not cosmetic organization. A directory determines the root configuration Terraform loads, a backend selects the state it uses, and that state defines the remote objects the root believes it owns. Directory structure therefore shapes blast radius, environment targeting, credentials, approval, and team ownership.

Suppose a production folder contains:

```text
prod/
├── backend.tf
├── main.tf
├── outputs.tf
├── providers.tf
└── variables.tf
```

When you run:

```bash
cd prod
terraform plan
```

Terraform reads the top-level `.tf` files in `prod/` together as one configuration. `main.tf` does not execute before `outputs.tf`, and splitting a resource across filenames does not create separate lifecycle or state boundaries. Filenames are for humans; references form Terraform's dependency graph.

```text
all top-level .tf files in working directory
                    |
                    v
             one root module
                    |
                    v
             one selected state
```

Keep these questions in view as you work through the lesson:

1. **What Does Terraform Execute in a Directory?**
2. **How Do State and Backends Define Ownership?**
3. **Why Does Layout Strengthen Environment Isolation?**
4. **How Does a `live/modules` Repository Work?**
5. **What Belongs in Root and Shared Module Folders?**
6. **How Fine-Grained Should Deployment Roots Become?**
7. **How Do Initialization and Planning Prove the Target?**
8. **Which Layout Rules Remain Useful as Systems Grow?**

## What Does Terraform Execute in a Directory?
<!-- section-summary: Terraform loads the top-level configuration files in the working directory as one root module, regardless of filename. -->

Nested directories are different. Terraform does not automatically merge a sibling `modules/application/` directory into the current root. That code participates only when the root calls it through a `module` block.

This makes the working directory a deployment input. Running from `live/dev/application` and `live/prod/application` loads different root configurations even if both call the same shared modules. Tools that automate Terraform should set the working directory explicitly rather than assuming the shell began in the intended place.

A root module is the top-level configuration used for one run. A child module is reusable configuration called by that root. The two may use the same Terraform language, but they serve different roles: the root selects a real deployment context; the child defines a reusable resource pattern.

The directory boundary also determines commands such as `terraform init`, `validate`, `plan`, and `apply`. Initialization stores local metadata under `.terraform/` for that root. A plan is calculated from that root's configuration, chosen backend state, variables, provider configurations, and current remote observations.

The first principle is therefore simple: Terraform executes a directory, not an individual `.tf` file. Layout decisions should be made in terms of deployable root configurations, not in terms of which filename looks most important.

## How Do State and Backends Define Ownership?
<!-- section-summary: State maps root-module addresses to remote objects, while the backend determines which state collection the current run reads and writes. -->

State contains associations such as:

```text
module.application.aws_instance.app[0]
        |
        v
i-0123456789abcdef0
```

That mapping tells Terraform which real object corresponds to a configuration address. A root with one state treats those managed addresses as one ownership set. Planning compares the root configuration with that state and with current remote information.

The backend selects where the ownership record lives. A production root might use:

```hcl
terraform {
  backend "s3" {
    bucket = "company-terraform-state"
    key    = "prod/app/terraform.tfstate"
    region = "eu-west-2"
  }
}
```

A development root can use a different key:

```hcl
terraform {
  backend "s3" {
    bucket = "company-terraform-state"
    key    = "dev/app/terraform.tfstate"
    region = "eu-west-2"
  }
}
```

The bucket can be shared while the keys keep ownership records separate:

```text
dev root  -> dev/app/terraform.tfstate  -> development resources
prod root -> prod/app/terraform.tfstate -> production resources
```

This separation is stronger than supplying `environment = "prod"` to one state. A variable may change names and sizes, but it does not change which state Terraform loaded. If development and production share one state, a single plan can reason about both environments and a single lock blocks both.

State is the practical blast-radius boundary. One mistaken plan can affect any object in the selected state for which the execution identity has permission. Smaller states can reduce that scope and allow independent release schedules. They also create interfaces between roots, so splitting is a tradeoff rather than an automatic virtue.

The backend is part of the target identity. A plan against production code and development state is not a production plan; it is a mismatched operation. Likewise, identical configuration and variable values can produce different plans when loaded with different states.

Protect remote state with locking, encryption, access control, recovery, and audit. Locking serializes writers to one state but does not coordinate separate states that happen to manage related infrastructure. Ownership boundaries need to be unambiguous enough that two states do not claim the same remote object.

## Why Does Layout Strengthen Environment Isolation?
<!-- section-summary: Safe targeting aligns directory, state, account, credentials, variables, and policy so one typo cannot switch the whole environment. -->

State isolation alone is incomplete. A production root can load the production key while the shell contains development credentials, or a development command can accidentally inherit production credentials. The resource names may say `prod` while the provider actually calls a different account.

A useful target model combines several coordinates:

| Coordinate | Development | Production |
|---|---|---|
| Root directory | `live/dev/...` | `live/prod/...` |
| State | `dev/...tfstate` | `prod/...tfstate` |
| Cloud account | Development account | Production account |
| Credentials | Development role | Production role |
| Variables | Development sizing | Production sizing |
| Policy | Fast feedback | Review and protected apply |

```text
TARGET = directory + state + provider identity + variables + approval context
```

When those dimensions agree, accidentally targeting production requires several independent controls to fail. By contrast, one directory with `dev.tfvars` and `prod.tfvars` lets one command-line argument select the environment:

```bash
terraform plan -var-file=dev.tfvars
terraform plan -var-file=prod.tfvars
```

A missing or mistyped argument can now carry too much authority. Separate roots make the intent visible in the path:

```text
live/
├── dev/
│   └── application/
└── prod/
    └── application/
```

```bash
cd live/prod/application
terraform plan
```

The path is not a security boundary by itself. It becomes valuable because CI policy, backend configuration, credentials, and approval can bind to it. A production directory can trigger a protected workflow and obtain a production role only after approval.

Resource names and tags are also not proof of target. `Environment = "prod"` is text sent through whichever provider identity is active. Verify the actual account or project and the backend state rather than inferring them from a resource label.

`terraform.tfvars` is configuration, not access control. It may choose production sizes or names, but it cannot prevent a development identity from attempting those settings in the wrong account. Environment isolation needs platform-level accounts, roles, and backend access as well as configuration differences.

## How Does a `live/modules` Repository Work?
<!-- section-summary: Shared modules describe reusable resource architecture, while live roots instantiate that architecture in concrete environments and regions. -->

A practical repository separates reusable definitions from deployed instances:

```text
terraform/
├── modules/
│   ├── application/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── network/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── live/
    ├── dev/
    │   └── eu-west-2/
    │       └── application/
    │           ├── backend.tf
    │           ├── main.tf
    │           ├── providers.tf
    │           ├── variables.tf
    │           └── terraform.tfvars
    └── prod/
        └── eu-west-2/
            └── application/
                ├── backend.tf
                ├── main.tf
                ├── providers.tf
                ├── variables.tf
                └── terraform.tfvars
```

`modules/application` says how an application stack is constructed. `live/prod/eu-west-2/application` says that one production instance of that design exists in a particular region, using a particular backend, account, provider configuration, and set of inputs.

Think of a shared module like a function:

```text
create_application(
  environment,
  instance_type,
  subnet_ids
)
```

Its variables form the input contract:

```hcl
variable "environment" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}
```

Its resources implement the behavior:

```hcl
resource "aws_instance" "app" {
  count = 2

  ami           = "ami-..."
  instance_type = var.instance_type
  subnet_id     = var.subnet_ids[count.index]

  tags = {
    Environment = var.environment
  }
}
```

The live root calls the function with concrete environment values:

```hcl
module "application" {
  source = "../../../../modules/application"

  environment   = var.environment
  instance_type = var.instance_type
  subnet_ids    = module.network.private_subnet_ids
}
```

The analogy has a useful limit. A module call creates resource addresses under the module path and those addresses are recorded in state. Changing the call label or moving resources between module paths is a state identity change that may require `moved` blocks.

Outputs complete the function-like contract. The shared network module can expose only the values application roots need:

```hcl
output "private_subnet_ids" {
  description = "Private subnet IDs for application workloads."
  value       = aws_subnet.private[*].id
}
```

The caller consumes `module.network.private_subnet_ids` instead of reaching into the child module's resource addresses. That keeps the module free to reorganize its internal implementation while preserving its public interface.

The separation also controls duplication. Development and production roots may contain similar module calls, but they do not need copied resource blocks. A bug fix in the reusable definition can be reviewed once and then rolled out to each environment through separate plans. Separate states ensure that changing the module source does not update every environment in one apply; each live root adopts the change under its own credentials and approval policy.

Local module source paths tie both layers to one repository revision. Remote module sources should use intentional version constraints or immutable refs. In either case, a live root records which reusable implementation it invokes, while its state records which real deployment that invocation owns.

## What Belongs in Root and Shared Module Folders?
<!-- section-summary: Deployment roots own backend, provider wiring, concrete values, and module composition; shared modules own reusable resources and contracts. -->

An environment root normally owns several context-specific concerns.

`backend.tf` selects the state for this deployed instance:

```hcl
terraform {
  backend "s3" {}
}
```

The concrete backend values can be supplied during initialization. `providers.tf` declares required providers and configures the region or other safe context:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
```

Credentials should come from the execution environment rather than hardcoded values. `main.tf` should mostly compose modules and pass outputs between them:

```hcl
module "network" {
  source = "../../../../modules/network"

  environment = var.environment
  cidr_block  = var.vpc_cidr
}

module "application" {
  source = "../../../../modules/application"

  environment   = var.environment
  instance_type = var.instance_type
  subnet_ids    = module.network.private_subnet_ids
}
```

Variables and `.tfvars` provide the environment's concrete configuration. Outputs publish the root's supported interface to people or other roots.

A shared child module should generally not own a backend. Backend selection belongs to the root because state represents the whole root configuration, not one child in isolation. A backend block inside a reusable child would misleadingly suggest the child can choose separate state when called.

Shared modules should also avoid embedded environment credentials and fixed provider configurations. They declare provider requirements; callers supply provider instances, including aliases when needed. This keeps one module reusable across accounts and regions.

Avoid placing environment-specific backend keys, account IDs, approval rules, or secret credentials inside shared modules. Accept real architectural inputs through typed variables, validate them, and expose useful outputs. The root remains responsible for turning that abstraction into a concrete deployment.

Concrete root values can be small while still making the deployment explicit:

```hcl
# live/prod/eu-west-2/application/terraform.tfvars
environment   = "prod"
aws_region    = "eu-west-2"
instance_type = "m7i.large"
vpc_cidr      = "10.20.0.0/16"
```

These values describe the production instance of the design. They should not contain provider credentials or be mistaken for proof that the provider is connected to production. If a value is secret, use an appropriate secret-delivery design rather than relying on the filename.

Root outputs should also be deliberate. Publishing a load-balancer address may form a supported contract. Publishing every internal resource ID couples consumers to the implementation and makes future module or state refactors harder. The live root is an API boundary between deployment units as well as a directory of Terraform code.

This division makes review clearer:

```text
module review
    Is this reusable resource design correct?

live-root review
    Is this the correct instance, target, state, identity, and set of values?
```

## How Fine-Grained Should Deployment Roots Become?
<!-- section-summary: State roots should align with ownership and lifecycle, but excessive splitting creates coordination and interface costs. -->

As a system grows, one root per entire environment can become too broad. A stronger production tree might separate global foundations, regional networks, shared services, and applications:

```text
live/prod/
├── global/
│   └── identity/
└── eu-west-2/
    ├── network/
    ├── shared-services/
    ├── application-a/
    └── application-b/
```

Each leaf root can have its own state, permissions, owners, and deployment cadence. An application change no longer needs to lock the network state. A team role can manage its application without permission to modify organization-wide identity.

Choose boundaries using questions such as:

```text
Do these resources change together?
Do they share the same owners and approvers?
Should one failure or lock block the others?
Do they require the same credentials?
Is the dependency between them stable enough to become an interface?
```

Do not split state for every resource. Too many roots create remote-state dependencies, duplicated provider setup, ordering coordination, discovery problems, and a large number of tiny pipelines. Resources whose lifecycle is tightly coupled may be easier and safer in one state.

For example, a load balancer and the target group it exclusively owns may change together and benefit from one plan. A shared regional network and an application fleet often have different owners and release frequencies, so separate roots may be clearer. The answer follows lifecycle and authority, not whether the resources use the same cloud provider.

State boundaries also affect recovery. Restoring one state should not silently roll back unrelated systems. Conversely, a cross-state dependency must survive one side being restored or redeployed. Stable identifiers and explicit outputs make those contracts understandable during an incident.

The dependency direction matters. A network root can publish subnet IDs. An application root can consume them through remote state or another discovery contract. The application should not need to reach into the network root's private resource addresses.

Environment folders and CLI workspaces solve related but different problems. Directories create visibly separate root configurations and can carry different backend, provider, module composition, and policy. CLI workspaces give one initialized configuration multiple named state slots. Workspaces fit similar deployments; directories are clearer when environments differ operationally.

Granularity should follow deployment architecture, not the desire for a neat tree. A root is a unit of state ownership, locking, planning, applying, recovery, and authorization. Make it as small as needed for safe independent operation, but large enough to preserve coherent lifecycle and understandable interfaces.

## How Do Initialization and Planning Prove the Target?
<!-- section-summary: init establishes backend and provider dependencies, while a trustworthy plan records the root, state, credentials, variables, and provider destination that produced it. -->

`terraform init` prepares one root directory. It configures the backend, installs child modules, selects provider packages according to constraints and the lock file, and creates local `.terraform/` metadata. A backend change may require explicit reconfiguration or migration; do not assume editing `backend.tf` silently moves state.

Partial backend configuration keeps reusable or non-secret code separate from deployment parameters:

```hcl
terraform {
  backend "s3" {}
}
```

```hcl
# backend.hcl
bucket = "company-terraform-state"
key    = "prod/app/terraform.tfstate"
region = "eu-west-2"
```

```bash
terraform init -backend-config=backend.hcl
```

The supplied file is still operationally important. A wrong key selects the wrong ownership record, and backend credentials can be sensitive. CI should generate or select it through a controlled target definition rather than letting operators improvise paths.

Initialization can reveal configuration drift in its own layer. A changed provider constraint may select a different package unless the dependency lock file preserves the reviewed version. A changed module source may download different code. A changed backend can prompt state migration. Review those changes separately from the resource plan because they determine which code and ownership record the plan will use.

If a local directory was previously initialized against development and is then repointed at production, stale `.terraform/` metadata can create confusing prompts or assumptions. Automation should start from a clean checkout or deliberately reinitialize the chosen root. Humans should read backend migration and reconfiguration prompts instead of accepting them reflexively.

Before planning, print and verify the context:

```text
working directory: live/prod/eu-west-2/application
backend key:       prod/application/terraform.tfstate
cloud account:     production account ID
region:            eu-west-2
variable set:      production
commit:            reviewed revision
```

Then create and render the plan:

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan
```

The resource names inside the plan do not prove the target. A bucket tagged `prod` can be created through development credentials. The evidence should include the actual caller identity and backend selection alongside the plan actions.

Saved plans are tied to their planning context. Apply them in a compatible environment using the same configuration and provider selections. Plan files can contain sensitive data, so protect the artifact while connecting approval to the exact operations later executed.

Production should ideally use distinct credentials. Directory and backend mistakes then meet a separate account boundary: a development role cannot modify production even if someone loads a production-looking variable file. Defense in depth makes the target a verified tuple rather than a hopeful folder name.

A reviewable pipeline can calculate that tuple from one declared stack record rather than assembling it independently in several steps. The record maps a stack name to its working directory, backend configuration, account ID, region, role, and variable source. Planning prints the resolved mapping; applying resolves it again and refuses any mismatch with the saved evidence. This reduces the chance that a correct plan artifact is later used with the wrong backend or identity.

Manual execution should follow the same discipline. Check `pwd`, inspect the active backend and workspace, verify the cloud caller, and render the plan before approval. Shell history is not an audit record, so record the target and outcome through the team's change process.

## Which Layout Rules Remain Useful as Systems Grow?
<!-- section-summary: Durable layouts keep reusable architecture separate from deployed instances and make every state, identity, and ownership boundary explicit. -->

The repository expresses two architectures at once.

**Resource architecture** describes networks, applications, databases, policies, and their dependencies. Shared modules capture repeatable parts of that design.

**Deployment architecture** describes which instances exist, where they run, which state owns them, which identity can change them, and how teams release them. Live roots capture that operational structure.

Another analogy is useful: modules resemble classes, while live roots plus state identify deployed instances. `modules/application` defines a type. `live/prod/eu-west-2/application` calls that type with production values, and its state associates the resulting addresses with real production objects.

Rules that tend to age well are:

```text
Treat every deployable directory as one root module.
Give each root one unambiguous state ownership boundary.
Keep development and production state separate.
Align production state with production accounts, credentials, and approvals.
Keep backends and environment authentication in roots, not shared children.
Let live roots compose modules rather than duplicate resources.
Make module inputs and outputs explicit contracts.
Split state around ownership and lifecycle, not arbitrary file count.
Avoid two states claiming the same remote object.
Print target evidence before plan and apply.
Treat tfvars as configuration, not authorization.
Use moved blocks when layout refactors change resource addresses.
```

Putting it together, a developer changes reusable resource logic in `modules/application` or environment-specific composition under one live root. CI initializes the exact directory with its backend parameters, verifies the cloud identity, loads the approved variables, and creates a saved plan. Reviewers see which state and account the plan targets. A protected job applies that plan under the correct role.

The purpose of layout is not to maximize directory depth. It is to make dangerous ambiguity difficult. A reader should be able to locate a root and answer: what does it deploy, which state owns it, which environment and region does it target, which credentials may change it, and which modules supply its reusable design?

Repository boundaries can follow organizational needs without changing the model. Modules may live beside live roots, in a versioned internal registry, or in separate repositories. Live roots may be grouped by account first or by region first. The durable requirement is that the path and metadata reveal one deployable ownership unit and that dependencies cross boundaries through supported contracts.

Changing the layout is itself infrastructure work. Moving files within the same root normally changes only human organization because Terraform still loads the same directory. Moving a resource into a child module, renaming a module call, or splitting one root into two changes addresses or state ownership. Use `moved` blocks, state move procedures, or carefully staged imports as appropriate, and require a plan that shows no unintended destruction.

The resulting layout should make routine changes boring. A developer can identify the reusable definition or concrete deployment to edit, the pipeline can derive one target, reviewers can see the corresponding state and identity, and operators can recover one root without guessing which other resources it secretly owns.

Document ownership in the surrounding repository metadata and automation rather than inventing hidden conventions. A new team member should be able to run read-only checks, locate the state and module versions, and understand the approval path before receiving write authority. Clarity is part of the safety boundary because ambiguous infrastructure is difficult to review under pressure.

Terraform loads the configuration files in a working directory as one module; filenames organize people, not execution order. Split providers, variables, resources, locals, and outputs when it improves navigation, but rely on references and the dependency graph for ordering. Keep generated state, crash logs, plan files, and local variable secrets under an explicit ignore and retention policy. Commit human-authored configuration and the dependency lock according to the team's reproducibility rules, and keep environment roots isolated so one working directory maps to one clear state boundary.

The command boundary follows the directory boundary. Run `terraform init` for the selected root and backend, inspect `terraform state list` only against the intended state, and review `terraform plan` before `terraform apply`. A CLI workspace changes the state slot inside that initialized root; it does not automatically create a separate backend, credential, account, or repository boundary.

## Check Your Answers

:::expand[What Does Terraform Execute in a Directory?]{kind="recap"}
Terraform combines top-level `.tf` files in the working directory into one root module. Filenames organize code but do not create execution or state boundaries.
:::

:::expand[How Do State and Backends Define Ownership?]{kind="recap"}
State maps addresses to remote objects, and the backend selects that ownership record. One selected state defines the practical scope of a run.
:::

:::expand[Why Does Layout Strengthen Environment Isolation?]{kind="recap"}
Separate roots act as safety controls only if directory, state, account, credentials, variables, and approval policy all point at the same environment.
:::

:::expand[How Does a `live/modules` Repository Work?]{kind="recap"}
Shared modules define reusable resource architecture. Live roots instantiate it with concrete backend, provider, region, environment, and input choices.
:::

:::expand[What Belongs in Root and Shared Module Folders?]{kind="recap"}
Roots own deployment context and composition. Children own reusable resources, typed inputs, outputs, and provider requirements without credentials or backends.
:::

:::expand[How Fine-Grained Should Deployment Roots Become?]{kind="recap"}
Split around independent ownership, permissions, lifecycle, and failure domains, but keep tightly coupled resources together and avoid excessive coordination overhead.
:::

:::expand[How Do Initialization and Planning Prove the Target?]{kind="recap"}
Initialization establishes backend and dependencies. A trustworthy plan is reviewed beside its directory, state key, real provider identity, variables, region, and commit.
:::

:::expand[Which Layout Rules Remain Useful as Systems Grow?]{kind="recap"}
Keep reusable and deployed architecture separate, make ownership explicit, align environment controls, and treat layout refactors as state-aware changes.
:::

---

**References**

- [Terraform: Files and configuration structure](https://developer.hashicorp.com/terraform/language/files)
- [Terraform: State](https://developer.hashicorp.com/terraform/language/state)
- [Terraform: Backend configuration](https://developer.hashicorp.com/terraform/language/backend)
- [Terraform: Modules](https://developer.hashicorp.com/terraform/language/modules)
- [Terraform: Standard module structure](https://developer.hashicorp.com/terraform/language/modules/develop/structure)
- [Terraform CLI: init](https://developer.hashicorp.com/terraform/cli/commands/init)
- [Terraform: Refactoring with moved blocks](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Terraform: Workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces)
