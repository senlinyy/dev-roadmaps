---
title: "Input Variables"
description: "Parameterize your Terraform configurations with input variables so the same code works across different environments and teams."
overview: "Input variables are the public inputs to a Terraform root module. This article shows how variables are declared, how values are supplied, where they are consumed in resources and locals, and how the evaluated values appear in plan output."
tags: ["variables", "input", "parameterization", "terraform", "hcl"]
order: 5
id: article-iac-terraform-values-input-variables
aliases:
  - infrastructure-as-code/terraform/values/input-variables.md
---

## Table of Contents

1. [What Problem Do Input Variables Solve?](#what-problem-do-input-variables-solve)
2. [How Does a Variable Declare a Module Contract?](#how-does-a-variable-declare-a-module-contract)
3. [How Do Types, Defaults, Null, and Validation Shape Inputs?](#how-do-types-defaults-null-and-validation-shape-inputs)
4. [How Does a Root Module Receive Values and Resolve Precedence?](#how-does-a-root-module-receive-values-and-resolve-precedence)
5. [How Do Parent Modules Supply Child Module Inputs?](#how-do-parent-modules-supply-child-module-inputs)
6. [How Do Variables Flow Through the Desired-State Graph?](#how-do-variables-flow-through-the-desired-state-graph)
7. [How Should Sensitive and Ephemeral Inputs Be Handled?](#how-should-sensitive-and-ephemeral-inputs-be-handled)
8. [How Do Variables Define a Useful Module Boundary?](#how-do-variables-define-a-useful-module-boundary)
9. [Check Your Answers](#check-your-answers)

An input variable is a value that a Terraform module lets someone outside that module choose. If a module were a function, variables would be its parameters.

Start with a fixed resource:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"

  tags = {
    Environment = "dev"
  }
}
```

Terraform can create exactly that server. Different instance requirements such as `t3.micro` for development and `m7i.large` for production make the design awkward. Editing or copying the resource mixes two different concerns: the lasting infrastructure logic and the choices for one deployment.

```text
lasting logic
= create an application server

deployment choices
= environment, size, subnet, count
```

A value that legitimately differs between deployments is a candidate for parameterization:

```hcl
variable "instance_type" {
  type = string
}

resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = var.instance_type
}
```

Keep these questions in view as you work through the lesson:

1. **What Problem Do Input Variables Solve?**
2. **How Does a Variable Declare a Module Contract?**
3. **How Do Types, Defaults, Null, and Validation Shape Inputs?**
4. **How Does a Root Module Receive Values and Resolve Precedence?**
5. **How Do Parent Modules Supply Child Module Inputs?**
6. **How Do Variables Flow Through the Desired-State Graph?**
7. **How Should Sensitive and Ephemeral Inputs Be Handled?**
8. **How Do Variables Define a Useful Module Boundary?**

## What Problem Do Input Variables Solve?

Before this change, the module meant “create a `t3.micro` web server.” Afterwards, it means “create a web server whose size the caller chooses.” The caller can customize behavior without editing the implementation.

![A variable is part of the contract between a module and its caller](/content-assets/articles/article-iac-terraform-values-input-variables/variable-contract.png)

Variables are one entry point into Terraform's graph of values:

```text
caller supplies value
        │
        ▼
  input variable
        │
   ┌────┼──────────┐
   ▼    ▼          ▼
local  data      resource
       source    argument
```

This is not mutable storage. The caller chooses an input for a run, and expressions read it through `var.<name>`. If the module needs a transformed form, it computes a local instead of assigning a new value back to the variable.

The function analogy is useful:

```text
create_web_server(instance_type, environment, subnet_id)
```

resembles:

```hcl
variable "instance_type" { type = string }
variable "environment"   { type = string }
variable "subnet_id"     { type = string }
```

The analogy is not saying Terraform is an ordinary imperative language. It highlights the interface: a module accepts named inputs, uses them to evaluate desired infrastructure, and may publish results as outputs.

## How Does a Variable Declare a Module Contract?

Declaring a variable does not assign its value. This block:

```hcl
variable "instance_type" {
  type = string
}
```

says that the module accepts an input named `instance_type` and requires a string. It does not say that the value is `t3.micro`. Inside the module, the declaration creates the reference `var.instance_type`; a caller supplies the concrete value separately.

A fuller declaration can describe the contract:

```hcl
variable "instance_type" {
  type        = string
  description = "EC2 instance type for the application server"
  default     = "t3.micro"
}
```

Each part answers a different question:

- The block label creates the input name and its `var.instance_type` reference.
- `type` defines the accepted shape.
- `description` explains what the caller controls.
- `default` supplies a value when the caller does not.

A variable with no default is required. Terraform cannot invent an environment, account ID, subnet ID, or customer ID that the architecture expects the caller to choose. An interactive root-module run may prompt for a missing required value, while automated runs should supply it explicitly.

A default makes an input optional from the caller's perspective:

```hcl
variable "enable_monitoring" {
  type    = bool
  default = true
}
```

The useful question is not “Can I add a default?” but “Is there a sensible answer if the caller says nothing?” Monitoring may have a safe normal choice. A production password or customer identity does not. A required variable means the module refuses to guess; a default means the module intentionally owns an ordinary choice.

Descriptions matter because variables form a public interface. “Deployment environment, one of dev, staging, or prod” is more useful than “Environment.” Callers should understand the expected meaning without reading every resource that consumes the value.

Once declared, use the `var` namespace:

```hcl
resource "aws_instance" "web" {
  instance_type = var.instance_type
}
```

Neither `variable.instance_type` nor an unqualified `instance_type` refers to the input. The reference means “take the module input with this name and use its value in this expression.”

## How Do Types, Defaults, Null, and Validation Shape Inputs?

Infrastructure values have structure, so variable contracts should describe that structure. Terraform supports primitive types such as `string`, `number`, and `bool`, plus collection and structural types such as `list(...)`, `set(...)`, `map(...)`, `object(...)`, and `tuple(...)`.

```hcl
variable "availability_zones" {
  type = list(string)
}
```

can accept:

```hcl
availability_zones = [
  "eu-west-2a",
  "eu-west-2b",
  "eu-west-2c",
]
```

A related group of settings can be one object with a precise shape:

```hcl
variable "database" {
  type = object({
    engine         = string
    instance_class = string
    storage_gb     = number
  })
}
```

The caller can provide:

```hcl
database = {
  engine         = "postgres"
  instance_class = "db.t4g.medium"
  storage_gb     = 100
}
```

and the module can read `var.database.engine`, `var.database.instance_class`, and `var.database.storage_gb`. A type constraint rejects the wrong shape before a provider receives a malformed request. It also documents the contract better than a loosely typed value.

Type-correct does not always mean acceptable. Every value below is a string, but only three belong to the intended environment set:

```text
dev
staging
prod
banana
destroy-everything
```

Use validation for the semantic rule:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"

  validation {
    condition = contains(
      ["dev", "staging", "prod"],
      var.environment
    )

    error_message = "Environment must be dev, staging, or prod."
  }
}
```

Terraform first checks “is it a string?” and then “is it one of the allowed strings?” A numeric validation can protect an architectural assumption just as directly:

```hcl
variable "instance_count" {
  type = number

  validation {
    condition     = var.instance_count >= 2
    error_message = "At least two application instances are required."
  }
}
```

That failure occurs before deploying an architecture that violates its minimum availability rule.

`null` introduces another distinction:

```hcl
variable "description" {
  type     = string
  nullable = true
  default  = null
}
```

An intentionally absent value is not the same as a missing required input. A required input with no value causes an error or prompt. An optional input with no caller value uses its default. A nullable input may deliberately contain no concrete value. The `nullable` setting controls whether callers are allowed to supply `null`.

![Types, defaults, and validation narrow the values a module accepts](/content-assets/articles/article-iac-terraform-values-input-variables/validation-and-defaults.png)

## How Does a Root Module Receive Values and Resolve Precedence?

The **root module** is the configuration directory where a Terraform operation starts. Its variable values can arrive through defaults, value files, command-line flags, environment variables, or a Terraform automation service.

A conventional `terraform.tfvars` file might contain:

```hcl
environment    = "prod"
instance_type  = "m7i.large"
instance_count = 3
```

Terraform automatically loads `terraform.tfvars`, `terraform.tfvars.json`, and files ending in `.auto.tfvars` or `.auto.tfvars.json`. A common human-readable layout is:

```text
main.tf              infrastructure logic
variables.tf         input declarations
terraform.tfvars     values for this deployment
```

Terraform normally reads the `.tf` files in a module together, so those names organize code for people rather than creating separate Terraform execution phases.

Environment-specific files can keep choices distinct:

```hcl
# dev.tfvars
environment    = "dev"
instance_type  = "t3.micro"
instance_count = 1
```

```hcl
# prod.tfvars
environment    = "prod"
instance_type  = "m7i.large"
instance_count = 3
```

Select one explicitly:

```bash
terraform plan -var-file="dev.tfvars"
terraform plan -var-file="prod.tfvars"
```

For a small one-off override, the CLI accepts `-var`:

```bash
terraform plan \
  -var="environment=prod" \
  -var="instance_type=m7i.large"
```

Structured values quickly become difficult to quote safely in a shell, so variable files are normally clearer for complex inputs.

Terraform also reads environment variables whose names start with `TF_VAR_`:

```bash
export TF_VAR_environment="prod"
export TF_VAR_instance_type="m7i.large"
terraform plan
```

`TF_VAR_environment` supplies `var.environment`. This mechanism is often convenient in CI/CD, where a workflow can inject a value without writing it into configuration.

If several mechanisms set the same input, Terraform uses deterministic precedence. A simplified low-to-high view is:

```text
variable default
      │
TF_VAR_ environment variable
      │
terraform.tfvars
      │
*.auto.tfvars
      │
-var and -var-file
```

JSON variants, lexical ordering among auto-loaded files, and HCP Terraform add details to the complete rules. The practical lesson is that an explicit invocation-time value can override a broad default. When a surprising value appears in a plan, trace every possible source instead of assuming the declaration's default won.

## How Do Parent Modules Supply Child Module Inputs?

Root-module values and child-module values enter through different boundaries. Suppose a configuration is arranged like this:

```text
root/
├── main.tf
└── modules/
    └── web/
        ├── main.tf
        └── variables.tf
```

The child declares an input in `modules/web/variables.tf`:

```hcl
variable "instance_type" {
  type = string
}
```

You do not normally place a separate `terraform.tfvars` in that child directory and expect the root run to load it. The parent supplies the child input as an argument in the module block:

```hcl
module "web" {
  source = "./modules/web"

  instance_type = "t3.large"
}
```

The distinction is:

```text
root-module variable
       ▲
       │ defaults, tfvars, TF_VAR_, CLI, automation

child-module variable
       ▲
       │ argument in the parent's module block
```

The parent can pass through one of its own inputs:

```hcl
variable "web_instance_type" {
  type = string
}

module "web" {
  source = "./modules/web"

  instance_type = var.web_instance_type
}
```

Now the value crosses two interfaces: the root receives it from the operator, and the child receives it from the parent. Each module owns its own input namespace and contract.

A child input can also receive a value computed by another resource:

```hcl
resource "aws_something" "example" {
}

module "consumer" {
  source = "./modules/consumer"

  object_id = aws_something.example.id
}
```

Before apply, `aws_something.example.id` may be unknown because the provider has not created the object. The child's `var.object_id` is then unknown too. This does not break the variable contract: the input is still a Terraform value, and unknown information can travel across the module boundary while the dependency graph stays intact.

Think of the module call like passing an argument to a function, but keep Terraform's planning model in view. The expression can carry a known literal, a root input, a local calculation, a data-source result, or a provider-computed resource attribute. What matters is that the parent explicitly connects its graph to the child's public interface.

## How Do Variables Flow Through the Desired-State Graph?

Variables are not infrastructure objects. A plan does not normally contain a separate cloud object called `var.instance_type`; it shows the effect of the evaluated input on resources.

Given:

```hcl
variable "instance_type" {
  type = string
}

resource "aws_instance" "web" {
  instance_type = var.instance_type
}
```

and:

```hcl
# terraform.tfvars
instance_type = "t3.large"
```

the plan can show:

```text
# aws_instance.web will be created

+ resource "aws_instance" "web" {
    + instance_type = "t3.large"
  }
```

Terraform has evaluated `var.instance_type`, placed the result into the desired resource argument, and displayed the resulting infrastructure. Changing the input to `t3.micro` does not issue an imperative “resize” command. It changes the desired-state calculation; Terraform compares the new result with the current managed object, and the provider determines whether that difference means an in-place update or replacement.

Root inputs are usually known before the useful resource plan is constructed. Defaults, files, environment variables, CLI arguments, and automation supply them early enough for expressions such as:

```hcl
count = var.instance_count
```

to determine how many instances should exist. As the child-module example showed, an input is not guaranteed to be known merely because it is called a variable. A provider-computed parent value can remain `(known after apply)` as it passes into a child.

Variables and locals play different roles:

```hcl
variable "project" {
  type = string
}

variable "environment" {
  type = string
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}
```

The caller chooses `project` and `environment`; the module derives `name_prefix`. Asking the caller to supply `payments-prod-web` would expose a value that the module can calculate from more fundamental choices. Inputs are immutable; transformed values belong in expressions or locals:

```hcl
locals {
  normalized_environment = lower(var.environment)
}
```

It helps to distinguish the main sources and destinations of values:

| Construct | Meaning |
| --- | --- |
| `var.region` | A caller supplied a value to this module |
| `data.aws_vpc.shared.id` | Terraform read a value from an external system |
| `aws_instance.web.id` | A value came from infrastructure Terraform manages |
| `local.name_prefix` | The module computed a named expression |
| an `output` value | The module publishes a result outside its boundary |

Information can enter through a variable, be normalized in a local, select something through a data source, configure a resource, and finally leave through an output. Not every configuration uses all five steps, but the distinctions reveal who owns each value and when it can become known.

## How Should Sensitive and Ephemeral Inputs Be Handled?

Passwords, API tokens, private keys, and credentials require more than an ordinary string declaration. Terraform lets a variable be marked sensitive:

```hcl
variable "database_password" {
  type        = string
  description = "Password used by the application database"
  sensitive   = true
}
```

If the value flows into a resource:

```hcl
resource "some_database" "main" {
  password = var.database_password
}
```

normal plan and apply output redacts it:

```text
password = (sensitive value)
```

Sensitivity propagates through expressions that depend on a sensitive input. This reduces accidental display in terminals and logs, but it does not traditionally keep the value out of Terraform state. Keep these statements separate:

```text
sensitive = true
    means hide normal display

sensitive = true
    does not mean encrypted
    does not mean absent from state
```

Because state may retain real secret values, protect the state backend, its access controls, backups, and any saved plan files as sensitive infrastructure data. Redaction at the CLI is not a replacement for storage security.

Modern Terraform also supports ephemeral variables for values that should be omitted from state and plan files, with restrictions on where such values may flow:

```hcl
variable "session_token" {
  type      = string
  sensitive = true
  ephemeral = true
}
```

The two settings address different risks:

```text
sensitive
└── do not reveal the value in ordinary output

ephemeral
└── do not persist the value in state or plan data
```

A short-lived session token may need both. Ephemeral values cannot be used everywhere because Terraform must persist ordinary resource planning information across operations. Follow the allowed-flow rules rather than assuming `ephemeral` can be added to any secret and passed to any argument.

Supplying secrets safely is also separate from declaring them. A committed `prod.tfvars` file containing a plaintext password remains a disclosure even if the variable is marked sensitive. CI/CD systems commonly inject credentials through protected environment or secret mechanisms. The variable contract controls Terraform's treatment of the value; the delivery path and state backend controls determine who can retrieve it.

## How Do Variables Define a Useful Module Boundary?

A reusable module should expose meaningful choices without turning every provider argument into a public switch. Ask whether two legitimate consumers of the module could reasonably need different values. Environment, size, count, network ID, and approved tag additions may belong at the interface. A deliberate architectural invariant should normally stay inside.

If a module exposes dozens of provider settings unchanged, callers must understand the provider nearly as well as the module author. The module becomes a thin wrapper instead of an architectural abstraction. A smaller input surface lets the implementation choose safe details and gives the caller a clearer contract.

Consider a module that lets callers choose environment, server size, and instance count while calculating its own naming.

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"

  validation {
    condition = contains(
      ["dev", "staging", "prod"],
      var.environment
    )

    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type"
  default     = "t3.micro"
}

variable "instance_count" {
  type        = number
  description = "Number of application servers"
  default     = 1

  validation {
    condition     = var.instance_count >= 1
    error_message = "At least one instance is required."
  }
}
```

The module computes a name rather than asking the caller to assemble one:

```hcl
locals {
  name_prefix = "payments-${var.environment}"
}

resource "aws_instance" "web" {
  count = var.instance_count

  ami           = "ami-123456"
  instance_type = var.instance_type

  tags = {
    Name        = "${local.name_prefix}-web-${count.index + 1}"
    Environment = var.environment
  }
}
```

Production supplies only its choices:

```hcl
# prod.tfvars
environment    = "prod"
instance_type  = "m7i.large"
instance_count = 3
```

and selects them for the plan:

```bash
terraform plan -var-file="prod.tfvars"
```

Follow the values through the evaluation. `environment = "prod"` becomes `var.environment`, which helps form `local.name_prefix = "payments-prod"`. `instance_count = 3` makes three addressed instances:

```text
aws_instance.web[0]
aws_instance.web[1]
aws_instance.web[2]
```

Their visible names become:

```text
payments-prod-web-1
payments-prod-web-2
payments-prod-web-3
```

and each uses `m7i.large`. The flow is:

```text
                         caller
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
    "prod"            "m7i.large"              3
       │                   │                   │
       ▼                   ▼                   ▼
var.environment    var.instance_type   var.instance_count
       │                   │                   │
       ▼                   │                   ▼
local.name_prefix          │               count = 3
       │                   │                   │
       └───────────┐       │       ┌───────────┘
                   ▼       ▼       ▼
                   aws_instance.web
                         │
                         ▼
                  desired infrastructure
```

The plan shows the resulting server count, types, and tags rather than presenting variables as separate infrastructure. Changing a variable changes the inputs to that calculation. Terraform then derives the lifecycle consequences by comparing the newly desired resources with current managed reality.

![Variables define the public boundary around a module's hidden implementation](/content-assets/articles/article-iac-terraform-values-input-variables/variables-summary.png)

A compact placement rule is useful:

```text
variable
= someone outside this module chooses it

local
= this module calculates it

data source
= Terraform discovers it externally

resource attribute
= managed infrastructure produces it

output
= this module publishes it
```

That rule prevents both hard-coded deployment choices and an oversized interface. Input variables separate what a module does from the values its callers are deliberately allowed to choose. Types and validation protect the boundary, defaults express safe module opinions, root and child modules receive values through different paths, and sensitivity or ephemerality controls how particular inputs may be exposed or retained.

The boundary becomes clearer if you test a few possible inputs. A caller may reasonably choose whether a development deployment runs one instance and production runs three. That is a legitimate variation. The module may require every instance to carry a managed-by tag and follow one naming convention. Those are implementation policies, so exposing them as arbitrary strings would weaken the abstraction. The interface should represent intended choices, not every value that happens to appear in the provider schema.

The same reasoning applies to defaults. `instance_type = "t3.micro"` can be a useful default when the module's ordinary use is small, but a production account ID cannot be inferred safely. A default is part of the module's behavior and must remain reasonable across its supported consumers. Required inputs force callers to acknowledge decisions that the module cannot or should not make.

When reading a real plan, trace values rather than searching for a variable inventory. If `prod.tfvars` changes `instance_type` from `t3.micro` to `m7i.large`, Terraform substitutes that value into every consuming expression. The provider then evaluates the resulting resource difference. One consumer may update in place, another may need replacement, and a local or output may simply recalculate. The variable itself has no lifecycle operation; its downstream effects do.

This distinction also makes debugging more systematic. If a resource has the wrong desired value, first locate the expression that supplied its argument. Follow references backward through locals until you reach the input source. Then check whether a default, automatically loaded file, named `-var-file`, environment variable, or CLI override won. For a child module, inspect the parent's module block before looking for a tfvars file inside the child. The value graph and precedence rules together explain the result.

Unknown child inputs deserve the same discipline. A parent can pass an ID that the provider will create only during apply. Terraform does not need a fake placeholder; it carries the unknown value and its dependency into the child. If the child's use of that value can also remain unknown until apply, planning continues. The important relationship is still known even though the concrete string is not.

Finally, distinguish public configuration from secret handling. A password can be a required variable because the caller must choose or supply it, but that does not make a normal tfvars file a safe secret store. `sensitive` changes display behavior, and `ephemeral` changes supported persistence behavior. Access control for the system that injects the value and for the backend that stores Terraform data remains an operational responsibility outside the variable block.

In short, decide where a value originates before choosing a construct. If the caller owns the decision, declare a focused variable contract. If the module can derive the answer, calculate it locally. If a remote system owns the answer, read it through a data source or managed resource attribute. If another caller needs the result, publish an output. This origin-based test keeps interfaces small while preserving a clear, inspectable flow of values through the module.

It also gives reviewers a practical contract: callers can see exactly what they may change, module authors can evolve hidden implementation details, and Terraform can validate inputs before those values reach provider operations.

Input sources should remain visible and typed. Defaults make a value optional, environment and variable files provide contextual inputs, and explicit CLI values can override them for one run. Do not build ordinary production behavior around hidden shell state. Use type constraints, nullable behavior, and validation to turn the variable block into an executable interface, then inspect the plan to confirm that the effective value changes only the intended resources. Sensitive marking protects display paths, not storage in state or every downstream expression.

## Check Your Answers

:::expand[What Problem Do Input Variables Solve?]{kind="recap"}
Variables separate reusable infrastructure logic from choices that differ between deployments. The caller supplies an input, and the module uses it without requiring source edits or copied resource blocks.
:::

:::expand[How Does a Variable Declare a Module Contract?]{kind="recap"}
A variable block declares a name, type, description, and optional default. It creates `var.<name>` inside the module but does not itself assign the caller's concrete value.
:::

:::expand[How Do Types, Defaults, Null, and Validation Shape Inputs?]{kind="recap"}
Types enforce value shape, validation enforces domain rules, defaults express a sensible fallback, and `nullable` distinguishes an intentional `null` from a missing required input.
:::

:::expand[How Does a Root Module Receive Values and Resolve Precedence?]{kind="recap"}
Root inputs can come from defaults, tfvars files, `TF_VAR_` environment variables, CLI arguments, or automation. Deterministic precedence decides which value wins when sources overlap.
:::

:::expand[How Do Parent Modules Supply Child Module Inputs?]{kind="recap"}
A root module receives invocation values, while a child receives arguments from its parent's module block. Values, including unknown resource attributes, can cross that explicit boundary.
:::

:::expand[How Do Variables Flow Through the Desired-State Graph?]{kind="recap"}
Variables are immutable input values, not cloud objects. Expressions and locals transform them, resources consume them, and plans show their effect on desired infrastructure.
:::

:::expand[How Should Sensitive and Ephemeral Inputs Be Handled?]{kind="recap"}
`sensitive` redacts ordinary output but may still leave a value in state. `ephemeral` prevents supported values from being persisted; delivery paths and state storage still require strong access controls.
:::

:::expand[How Do Variables Define a Useful Module Boundary?]{kind="recap"}
Expose choices that legitimate callers should control and keep architectural invariants inside. A focused, typed interface makes a module reusable without reducing it to a wrapper around every provider option.
:::

### References

- [Use input variables to add module arguments](https://developer.hashicorp.com/terraform/language/values/variables)
- [Terraform configuration language style guide](https://developer.hashicorp.com/terraform/language/style)
- [Terraform CLI environment variables](https://developer.hashicorp.com/terraform/cli/config/environment-variables)
- [`variable` block reference](https://developer.hashicorp.com/terraform/language/block/variable)
- [Protect sensitive input variables](https://developer.hashicorp.com/terraform/tutorials/configuration-language/sensitive-variables)
- [Manage values in modules](https://developer.hashicorp.com/terraform/language/values)
