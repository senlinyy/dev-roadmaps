---
title: "Module Contracts: Inputs and Outputs"
description: "Variable types, validation rules, and structured outputs give Terraform modules a clear, safe contract with callers."
overview: "Inputs and outputs form a typed boundary around a Terraform module. This article builds the full contract of a reusable private-bucket module, including defaults, object types, validation, sensitive and ephemeral values, output promises, graph edges, and composition."
tags: ["modules", "variables", "outputs", "validation", "terraform"]
order: 2
id: article-iac-terraform-modules-inputs-outputs
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/module-inputs-and-outputs.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/module-inputs-and-outputs.md
---

## Table of Contents

1. [Why Does a Module Need a Contract?](#why-does-a-module-need-a-contract)
2. [How Do Inputs Define Caller Decisions?](#how-do-inputs-define-caller-decisions)
3. [How Do Types and Validation Strengthen Inputs?](#how-do-types-and-validation-strengthen-inputs)
4. [How Do Sensitive and Ephemeral Values Differ?](#how-do-sensitive-and-ephemeral-values-differ)
5. [How Do Outputs Define Module Promises?](#how-do-outputs-define-module-promises)
6. [How Do Outputs Connect Module Graphs?](#how-do-outputs-connect-module-graphs)
7. [How Does a Complete Module Contract Work?](#how-does-a-complete-module-contract-work)
8. [How Do You Design a Contract That Stays Useful?](#how-do-you-design-a-contract-that-stays-useful)
9. [Check Your Answers](#check-your-answers)

Reusable code needs a way for the outside world to communicate with it without depending on its internal resources. Terraform creates that boundary with variables for values entering a module and outputs for values leaving it.

Consider a reusable private S3 bucket module:

```text
modules/
└── private-bucket/
    ├── main.tf
    ├── variables.tf
    └── outputs.tf
```

Its implementation can contain:

```hcl
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

A caller needs only a module call:

```hcl
module "logs" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
}
```

The responsibilities differ. The caller decides that it wants a bucket with that name. The module decides that “private bucket” means an S3 bucket plus all four public-access protections and any other policy kept inside the abstraction.

Keep these questions in view as you work through the lesson:

1. **Why Does a Module Need a Contract?**
2. **How Do Inputs Define Caller Decisions?**
3. **How Do Types and Validation Strengthen Inputs?**
4. **How Do Sensitive and Ephemeral Values Differ?**
5. **How Do Outputs Define Module Promises?**
6. **How Do Outputs Connect Module Graphs?**
7. **How Does a Complete Module Contract Work?**
8. **How Do You Design a Contract That Stays Useful?**

## Why Does a Module Need a Contract?
<!-- section-summary: A module contract separates caller decisions from internal implementation through explicit values going in and promised values coming out. -->

The caller should not depend directly on internal names such as `aws_s3_bucket.this`. It should know the supported interface:

```text
inputs  → bucket_name, environment, tags
module  → resources, locals, data, expressions
outputs → bucket_id, bucket_arn
```

Inputs answer what the caller may or must decide. Outputs answer what results the module promises callers may consume. Internal resources can change while a stable contract continues to work.

This boundary also sets change expectations. Renaming a required input can break every caller. Removing an output can break downstream references. Adding an optional input with a safe default is usually easier to adopt. The contract therefore behaves like an API even though the module is declarative infrastructure code.

The function analogy can help if its limit stays visible. A private-bucket interface resembles `create_private_bucket(name, environment, tags) → { id, arn }`. Yet Terraform is not invoking a procedure that returns after doing work. The input and output expressions connect a persistent subtree into the overall desired-state graph. Values can be unknown during planning, and the resulting resources remain managed in state.

The boundary is directional and explicit:

```text
caller expressions
       ↓
variable blocks, types, defaults, validation
       ↓
module resources, locals, and expressions
       ↓
output values, types, sensitivity, preconditions
       ↓
parent expressions
```

This visibility is the source of reuse. A caller sees the promise rather than copying internals. A module author can reason about which external decisions enter and which stable capabilities leave.

## How Do Inputs Define Caller Decisions?
<!-- section-summary: Variables make selected choices part of the public interface, and defaults distinguish required decisions from optional policy choices. -->

A literal bucket name inside the child prevents reuse:

```hcl
resource "aws_s3_bucket" "this" {
  bucket = "myapp-prod-logs"
}
```

Move the decision to the public interface:

```hcl
variable "bucket_name" {
  type        = string
  description = "Name of the S3 bucket."
}

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
}
```

The variable does not mainly mean “prompt a human.” At a module boundary, it means the caller is allowed and required to provide this value without modifying the child source. The value flows from the module argument to `var.bucket_name` and then to the resource argument.

A variable with no `default` is required:

```hcl
module "logs" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
}
```

A default makes an input optional:

```hcl
variable "enable_versioning" {
  type        = bool
  description = "Whether object versioning should be enabled."
  default     = true
}
```

Callers can omit the argument and receive `true`, or override it explicitly. A default is an API and policy decision. Use one when the module has a sensible normal choice. Omit it when every caller should choose deliberately.

Required and optional do not mean important and unimportant. A required bucket name is unique to the deployment, so no shared default is safe. An optional versioning flag can have a strong default that represents the module's normal policy. The design question is whether omission has one reasonable meaning, not whether the setting matters.

An explicit `null` is also different from omission and from an ordinary default. `null` represents absence and may cause the receiving argument to behave as though no value were supplied. If the contract wants to support absence, name and type that behavior deliberately instead of relying on callers to guess whether an empty string, empty collection, or `null` is appropriate.

Not every internal argument should become an input. A module named `private-bucket` should normally enforce all four public-access settings rather than offer four booleans that let callers reconstruct or weaken the mechanism. Expose decisions that belong to the caller; keep the module's invariants inside.

Inputs live in module-specific namespaces. If a root has `var.environment` and a child declares its own variable with the same name, the child does not receive it automatically. The root must wire the values:

```hcl
module "logs" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
  environment = var.environment
}
```

The right side is the root variable. The left side assigns the child's input, which becomes `var.environment` only inside that child. Explicit wiring keeps the boundary understandable.

The same explicitness prevents accidental global configuration. A child cannot silently read every root variable simply because names match. That makes modules reusable in roots that choose their values from literals, other variables, locals, data sources, resource attributes, or another child's outputs.

## How Do Types and Validation Strengthen Inputs?
<!-- section-summary: Types define value shape, while validation defines which values of that shape satisfy the module's own rules. -->

Types are part of the contract. These variables communicate different shapes:

```hcl
variable "environment" {
  type = string
}

variable "replica_count" {
  type = number
}

variable "enable_versioning" {
  type = bool
}

variable "subnet_ids" {
  type = list(string)
}

variable "tags" {
  type = map(string)
}
```

Terraform also supports sets, tuples, objects, and other structural types. The implementation can reason about `list(string)` as a sequence of strings instead of defending against every possible value shape. Terraform may perform reasonable conversions, but rejects values it cannot convert to the constraint.

Related settings can form an object:

```hcl
variable "bucket_config" {
  type = object({
    environment       = string
    owner             = string
    enable_versioning = optional(bool, true)
    tags              = optional(map(string), {})
  })
}
```

The caller supplies the required fields and may omit the optional ones:

```hcl
bucket_config = {
  environment = "prod"
  owner       = "platform"
}
```

The object documents that these values form one conceptual configuration. Optional attributes help the contract evolve without forcing every caller to repeat defaults.

A fully specified caller can still override both optional attributes:

```hcl
bucket_config = {
  environment       = "prod"
  owner             = "platform"
  enable_versioning = false

  tags = {
    Application = "payments"
    ManagedBy   = "terraform"
  }
}
```

Inside the module, each field has a known path and shape: `var.bucket_config.environment`, `var.bucket_config.owner`, `var.bucket_config.enable_versioning`, and `var.bucket_config.tags`. This removes whole categories of defensive conversion from the implementation.

Avoid `any` unless the module genuinely cannot describe a stable shape. `type = any` delegates most structure checking to later expressions and resources, producing a weaker interface and less useful errors.

Types are therefore executable constraints, not comments. A documented expectation can drift from implementation, while a type participates in evaluation. When a caller supplies a number where `list(string)` is required, Terraform rejects or converts the value according to its type rules before provider logic receives an incoherent shape.

![Validation Sensitive Flow](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/validation-sensitive-flow.png)

Type and validation answer different questions. `type = string` accepts `"dev"`, `"prod"`, and `"potato"` because all are strings. A validation rule narrows the accepted values:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

Another numeric rule can enforce a module invariant:

```hcl
variable "replica_count" {
  type        = number
  description = "Number of application replicas."

  validation {
    condition     = var.replica_count >= 1 && var.replica_count <= 10
    error_message = "replica_count must be between 1 and 10."
  }
}
```

The type says “number”; validation says which numbers this module supports. Rejecting invalid input at the contract boundary gives the caller a clear fix before the value travels through resources, provider logic, and a remote API.

Write error messages as repair instructions. “Invalid value” forces the caller to inspect module internals. “replica_count must be between 1 and 10” names the supported range immediately. Validation belongs where the module owns the invariant; provider-specific facts that cannot be known yet may require a resource precondition, test, or policy check instead.

Validation expressions can depend on values that are known at different phases. Literal caller settings are often known during planning, while an input produced by another resource may remain unknown until apply. Terraform evaluates the rule when the required information is available; this is declarative graph evaluation, not a procedural `if` executed in source order.

This timing affects what belongs at the input boundary. A rule about the string `environment` or the numeric range of `replica_count` can usually be evaluated early. A claim about a remote object that a provider has not created or refreshed may not be decidable yet. Do not force every invariant into a variable validation merely because it is the first validation feature you learned. Put the check at the earliest layer that actually has the necessary information.

Good constraints make invalid states harder to express while preserving legitimate callers. A tightly specified object can show related settings and defaults clearly; an overly permissive `any` postpones errors; an overly narrow type can prevent valid evolution. Treat the type as part of the API and review changes to it with the same care as renaming the variable.

## How Do Sensitive and Ephemeral Values Differ?
<!-- section-summary: Sensitive controls routine presentation, while ephemeral controls persistence; both properties are separate from backend and runtime secret design. -->

A sensitive variable tells Terraform to redact the value from normal CLI and UI presentation:

```hcl
variable "database_password" {
  type        = string
  description = "Password used by the application database user."
  sensitive   = true
}
```

Expressions derived from that input generally carry sensitivity too, so concatenating it does not casually reveal the secret in a plan. Redaction reduces accidental exposure in terminals and CI logs.

Sensitivity does **not** promise that the value is absent from state. If Terraform needs the value in resource arguments or outputs, ordinary sensitive data may still be persisted. Protect state access, storage, versions, plan artifacts, and any automation that can retrieve values. The backend is a security boundary.

Ephemeral answers a different question. A modern Terraform child input can be available during the operation while being omitted from plan and state artifacts:

```hcl
variable "session_token" {
  type      = string
  sensitive = true
  ephemeral = true
}
```

The distinction is:

| Property | Normal display | Persisted where ordinarily relevant |
|---|---|---|
| Ordinary | Visible | Yes |
| `sensitive = true` | Redacted | Can be |
| `ephemeral = true` | Persistence is the main concern | No |
| Sensitive and ephemeral | Redacted | No |

Ephemeral variables and child-module outputs are intended for contexts that can work without retaining the value. A root output cannot simply become ephemeral because root outputs are persistent results of the run. Provider write-only arguments are another mechanism for supported fields that accept a value for an operation without returning it into Terraform artifacts.

These features have context rules because Terraform normally depends on persisted values for future comparison. An ephemeral value can flow only through expressions and arguments that do not require it to be stored. If a value is needed later to detect drift, an ephemeral route may not be valid. The contract must match the lifecycle of the information, not only its secrecy.

Use the correct mental questions: sensitive asks whether humans should normally see the value; ephemeral asks whether Terraform should persist it. Neither makes a poor secret-distribution architecture automatically safe. Long-lived credentials often belong in a dedicated secret manager and should be fetched by the runtime identity instead of flowing as raw strings through Terraform.

Sensitive outputs use the same display rule:

```hcl
output "database_password" {
  value     = some_resource.example.password
  sensitive = true
}
```

The parent can still consume the value, but ordinary output is redacted. If the value reaches a root output or persistent resource argument, state protection remains necessary. An ephemeral child output can carry a temporary value across a module boundary only into another compatible ephemeral context.

Sensitivity also propagates. An output or local expression derived from a sensitive password generally becomes sensitive so routine rendering does not reveal it indirectly. Controlled tooling and users with state access can still retrieve persisted values, which is why redaction must never be confused with encryption, authorization, or non-persistence.

## How Do Outputs Define Module Promises?
<!-- section-summary: Outputs expose selected, typed results to the parent while keeping internal resource structure out of the public contract. -->

Outputs solve the opposite side of communication. The child knows `aws_s3_bucket.this.arn`, but callers should not reach into that internal resource path. The child publishes a stable name:

```hcl
output "bucket_arn" {
  type        = string
  description = "ARN of the bucket."
  value       = aws_s3_bucket.this.arn
}
```

The parent reads `module.logs.bucket_arn`. The public name can survive an internal resource rename or refactor as long as the output keeps the same meaning. Outputs are therefore module return values and compatibility promises, not merely lines printed after apply.

Current output blocks can state a type constraint. Descriptions explain semantic meaning. Sensitivity marks values that should be redacted. Preconditions can verify that the implementation is about to return something satisfying the promise:

```hcl
output "service_endpoint" {
  type        = string
  description = "HTTPS endpoint of the service."
  value       = aws_lb.this.dns_name

  precondition {
    condition     = aws_lb.this.load_balancer_type == "application"
    error_message = "The service endpoint requires an application load balancer."
  }
}
```

Input validation asks whether the caller provided an acceptable value. An output precondition asks whether the implementation produced a valid promise. These checks protect the two sides of the contract.

That symmetry helps locate failures. If a caller passes `environment = "potato"`, reject it at the input. If the module promises an application-load-balancer endpoint but its internal resource is the wrong load balancer type, fail the output precondition before publishing the result. The contract should explain whether responsibility lies with the caller's decision or the module's implementation.

Do not publish every internal ID just because it is available. An output invites callers to depend on it. `bucket_arn`, `bucket_id`, an endpoint, or a deliberately supported security group ID can represent useful capabilities. An internal helper resource ID often exposes anatomy that the module author should remain free to change.

Child and root outputs have different immediate audiences. A child output makes a value available to its parent as `module.<name>.<output>`. The parent may consume it internally, pass it to another child, or choose to re-export it as a root output:

```hcl
output "logs_bucket_arn" {
  value = module.logs.bucket_arn
}
```

Ordinary root outputs are stored in state and can be read later with `terraform output` or by other authorized automation. Publishing a child output does not automatically mean it must become a human-facing root output.

After apply, operators can inspect root outputs:

```bash
terraform output logs_bucket_arn
terraform output -raw logs_bucket_arn
terraform output -json
```

The first form is human-oriented, `-raw` emits a plain scalar for controlled scripts, and JSON includes structured value, type, and sensitivity metadata. Automation should avoid parsing the display table. These commands read persisted root output results from state, reinforcing why output design and backend access are linked.

A child output exists primarily for graph composition. The root decides whether that value should cross another boundary into an operator-facing or cross-configuration interface. Keeping those decisions separate avoids turning every internal child capability into permanent state API.

## How Do Outputs Connect Module Graphs?
<!-- section-summary: Passing one module's output into another module's input carries both a value and a dependency edge through the root composition layer. -->

Suppose an application module needs the logs bucket ARN. The root wires the producer to the consumer:

```hcl
module "logs" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
  environment = "prod"
}

module "application" {
  source = "../../modules/application"

  log_bucket_arn = module.logs.bucket_arn
}
```

Inside the application child:

```hcl
variable "log_bucket_arn" {
  type        = string
  description = "ARN of the bucket used for application logs."
}
```

The flow is:

```text
bucket resource
    ↓
child output bucket_arn
    ↓
module.logs.bucket_arn
    ↓
application input log_bucket_arn
    ↓
application resources
```

![Output Chain State Map](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/output-chain-state-map.png)

This is not only data transfer. The reference creates a graph edge, so Terraform understands that the producer must supply the value before dependent application operations can use it. The ARN may be unknown until apply, yet the dependency is already known during planning.

Passing the output is safer than reconstructing the ARN from a duplicated bucket name. One module owns the value, publishes it once, and every consumer follows the authoritative expression. Rebuilt strings create two places that claim knowledge of the same identity and can drift.

For example, this is fragile:

```hcl
module "logs" {
  bucket_name = "myapp-prod-logs"
}

module "application" {
  log_bucket_arn = "arn:aws:s3:::myapp-prod-logs"
}
```

Both calls encode knowledge of the same bucket independently. Replacing the literal with `module.logs.bucket_arn` makes the producer authoritative and preserves the dependency edge automatically.

The root is the natural wiring layer because it knows the overall architecture. The bucket module does not need to know which application consumes it. The application accepts any compatible ARN and does not need to know whether it came from a new bucket, an imported one, or another source. Explicit inputs and outputs keep the children independently understandable.

Inputs can therefore be expressions representing values that do not exist yet. A network module may publish subnet IDs that are known only after creation. Passing `module.network.private_subnet_ids` into an application child says “use whatever IDs this graph node produces,” not “call a function with a literal list right now.”

The plan can show the receiving value as `(known after apply)` while still ordering the graph correctly. This is where the function analogy stops being literal: a Terraform contract can carry a future value and its dependency relationship before the provider has created the object that will supply it.

Remember that variables and outputs are not shared globals. The root explicitly assigns each child input. The child explicitly publishes each output. The parent reads it through the module instance namespace. That regular syntax makes every cross-boundary connection visible.

## How Does a Complete Module Contract Work?
<!-- section-summary: A complete contract combines required and optional inputs, precise types, semantic validation, hidden implementation, and a small typed output surface. -->

The private-bucket module can now state its complete input contract in `variables.tf`:

```hcl
variable "bucket_name" {
  type        = string
  description = "Globally unique name for the S3 bucket."

  validation {
    condition     = length(var.bucket_name) >= 3
    error_message = "bucket_name must contain at least three characters."
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "tags" {
  type        = map(string)
  description = "Additional tags to apply to the bucket."
  default     = {}
}

variable "enable_versioning" {
  type        = bool
  description = "Whether object versioning should be enabled."
  default     = true
}
```

A reader can infer the interface without reading the resources. The bucket name and environment are required and validated. Tags and versioning are optional with defaults. The implementation can normalize tags and enforce privacy:

Each declaration carries a different part of the promise. The name is a required string with a minimum length. The environment is a required string with a closed allowed set. Tags are a map whose omission becomes an empty map. Versioning is a boolean whose omission becomes `true`. “Required,” “optional,” “shape,” and “acceptable value” are separate properties rather than one vague notion of configuration.

```hcl
locals {
  common_tags = merge(
    {
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

`local.common_tags` and the two resource addresses remain internal. Outputs publish only supported results:

The implementation may contain more resources and use `var.enable_versioning` to control its versioning behavior, but callers do not need internal local names or resource addresses. That hidden portion can grow as long as the public semantics remain compatible and any state-address refactors are handled safely.

```hcl
output "bucket_id" {
  type        = string
  description = "ID of the created bucket."
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  type        = string
  description = "ARN of the created bucket."
  value       = aws_s3_bucket.this.arn
}
```

Production calls the module with its decisions:

```hcl
module "logs" {
  source = "../../modules/private-bucket"

  bucket_name = "myapp-prod-logs"
  environment = "prod"

  tags = {
    Application = "payments"
    Team        = "platform"
  }
}
```

The default already enables versioning, so the caller need not repeat it. The parent can consume `module.logs.bucket_id` and `module.logs.bucket_arn` through the declared output contract.

The entire boundary is:

```text
INPUT
├── bucket_name       string, required and validated
├── environment       string, required and validated
├── tags              map(string), default {}
└── enable_versioning bool, default true

INTERNAL
├── locals
├── bucket
├── public-access settings
└── other implementation details

OUTPUT
├── bucket_id         string
└── bucket_arn        string
```

Terraform can evaluate unknown values through this boundary. It can also store ordinary root output results in state and later expose them through `terraform output`. Machine consumers should use `terraform output -json` or `-raw` as appropriate rather than parse human-oriented display. Sensitivity metadata affects normal presentation, but anyone authorized to retrieve the underlying state still belongs inside the security boundary.

The contract can be read as a typed interface:

```text
private_bucket(
  bucket_name: string,
  environment: string,
  tags: map(string) = {},
  enable_versioning: bool = true
) → {
  bucket_id: string,
  bucket_arn: string
}
```

This notation is only a reasoning aid. Terraform adds persistent nodes to a graph, and the returned values can themselves remain unknown until providers complete work. Still, the interface makes valid caller behavior and promised results visible in one compact view.

## How Do You Design a Contract That Stays Useful?
<!-- section-summary: Durable contracts expose intent and stable capabilities, keep invariants internal, minimize coupling, and distinguish API boundaries from state boundaries. -->

Contract design determines coupling. If a network module exposes a VPC ID and private subnet IDs, consumers depend on a deliberate network interface. If it exposes dozens of internal route, association, and helper resource IDs, callers become coupled to its anatomy even though the files live in separate directories.

Coupling grows in both directions. A child with dozens of pass-through inputs knows too little policy and forces every caller to understand its mechanics. A child with dozens of outputs allows consumers to reach deeply into those mechanics. A useful abstraction keeps the smallest interface that still expresses legitimate variation and composition.

The same principle applies to inputs. A weak private-bucket call asks callers to configure every S3 access flag, encryption mechanism, and internal control. A stronger call asks for a bucket name, environment, and legitimate policy choices while the module guarantees privacy and standard behavior. Caller intent stays outside; implementation mechanism stays inside.

![Module Contract Shape](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/module-contract-shape.png)

Use precise types so both humans and Terraform understand shape. Use defaults only for safe ordinary policy. Use validation for values that have the right type but violate a module invariant. Use sensitivity to reduce routine display and ephemeral values only where non-persistence is required and supported. Use output preconditions when the module must verify a returned promise.

Publish outputs with known consumers and durable meaning. Each output becomes an API surface other code may rely on. Do not expose an implementation detail merely because it is convenient today. The more internals callers can observe, the harder the module is to refactor safely.

Keep module and state boundaries separate. Inputs and outputs encapsulate a configuration component, but all child resources can still share the root's state and lifecycle. Root outputs are persisted operational results; child outputs primarily communicate with the parent. An API boundary does not create an independent backend.

Keep several other pairs separate as well:

```text
variable → what callers may provide
output → what callers may consume

type → what shape a value has
validation → which values of that shape are allowed

default → value used when the caller omits an optional input
null → explicit absence

sensitive → redact routine presentation
ephemeral → omit supported values from persistence
```

These distinctions prevent misleading contracts. A sensitive default is still a default. An optional object field still has a type. An output can be sensitive yet persisted. An ephemeral child output is still namespaced and explicitly wired.

The deepest model is a typed data boundary. Caller expressions enter through variables, pass type, default, validation, sensitivity, and persistence rules, and feed internal graph nodes. Output expressions leave through types, sensitivity, and preconditions. When a parent routes one child output into another child input, the boundary also carries a Terraform dependency edge.

A module is defined less by the number of resources inside it than by the promise at its edge. Inputs say which decisions callers may make. Validation says which configurations the module accepts. Implementation handles the mechanism. Outputs say which results callers may safely depend on. A clear promise is what makes the module reusable.

Review a contract from the caller's perspective. Can someone tell which inputs are required, what each value means, which defaults will apply, and what error explains a rejected value? Can they see which outputs are stable and whether any are sensitive? Then review it from the maintainer's perspective. Can the implementation change without breaking callers, and are policy invariants kept inside rather than delegated to every root? A contract that answers both sets of questions is easier to adopt and safer to evolve.

Finally, examine every cross-module value as architecture. The producer should publish it deliberately, the consumer should accept only the shape and meaning it needs, and the root should make the connection visible. This avoids shared globals, duplicated identities, and hidden ordering. A small set of well-named contracts turns several namespaced subtrees into one understandable infrastructure graph without erasing responsibility at their boundaries.

Contract changes should therefore be released deliberately. Adding a compatible optional input can preserve existing callers. Changing an input type, removing a default, renaming an output, or changing an output's meaning can require caller migrations. An internal resource refactor may leave the public contract unchanged while still requiring state-address moves. Interface compatibility and state compatibility are two reviews, and a mature module owner performs both before describing a release as safe.

The final practical test is simple: a caller should understand the module's choices and promises without reading its resources, while a maintainer should understand exactly which guarantees cannot change casually. That shared understanding is the contract's real long-term value and safety.

Treat contract evolution as a caller migration. Adding an optional input with a stable default can be compatible; renaming a required input, changing a type, or removing an output can break every root module at validation or plan time. Use validation and precise types to reject unsafe values early, and expose outputs that represent stable capability results rather than raw implementation details. Test both ordinary callers and deliberately invalid inputs so the module communicates errors at the boundary before provider operations begin.

An output crosses a configuration boundary, but it does not create a separate storage boundary. Root output values can be recorded in state, including values derived from child modules. Marking an output sensitive controls ordinary display; it does not remove the value from state. Design the contract to expose identifiers and connection facts that callers need while keeping secret payloads in the system that owns them.

## Check Your Answers

:::expand[Why Does a Module Need a Contract?]{kind="recap"}
The contract lets callers provide decisions and consume results without depending on internal resource names. It gives the module an API that can remain stable while implementation changes.
:::

:::expand[How Do Inputs Define Caller Decisions?]{kind="recap"}
Variables identify choices that legitimately belong to the caller. No default means the choice is required; a default supplies an optional safe policy value.
:::

:::expand[How Do Types and Validation Strengthen Inputs?]{kind="recap"}
Types describe value shape, while validation rejects unacceptable values of that shape. Precise constraints move useful errors to the module boundary.
:::

:::expand[How Do Sensitive and Ephemeral Values Differ?]{kind="recap"}
Sensitive values are redacted from normal presentation but may persist. Ephemeral values are omitted from plan and state in supported contexts; state security still matters.
:::

:::expand[How Do Outputs Define Module Promises?]{kind="recap"}
Outputs publish selected typed results to the parent, hide internal structure, and may carry sensitivity or preconditions. Each output is a compatibility promise.
:::

:::expand[How Do Outputs Connect Module Graphs?]{kind="recap"}
Passing a child output into another child input transfers an authoritative value and creates a graph dependency, even when the final value is unknown until apply.
:::

:::expand[How Does a Complete Module Contract Work?]{kind="recap"}
Required and optional inputs enter a private-bucket implementation, validations protect invariants, internal resources stay hidden, and bucket ID and ARN leave as supported outputs.
:::

:::expand[How Do You Design a Contract That Stays Useful?]{kind="recap"}
Expose intent, stable capabilities, and legitimate choices. Keep policy invariants and mechanism inside, minimize coupling, and remember that a module API is not a state boundary.
:::

### References

- [Input variables](https://developer.hashicorp.com/terraform/language/values/variables)
- [`variable` block reference](https://developer.hashicorp.com/terraform/language/block/variable)
- [Types and values](https://developer.hashicorp.com/terraform/language/expressions/types)
- [Optional object attributes](https://developer.hashicorp.com/terraform/tutorials/modules/module-object-attributes)
- [Output values](https://developer.hashicorp.com/terraform/language/values/outputs)
- [`output` block reference](https://developer.hashicorp.com/terraform/language/block/output)
- [Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
