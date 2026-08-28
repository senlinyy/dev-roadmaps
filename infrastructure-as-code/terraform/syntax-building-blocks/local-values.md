---
title: "Local Values"
description: "Name and reuse computed expressions inside a Terraform configuration, removing repetition and making complex logic readable."
overview: "Local values are named expressions inside a module. This article shows how locals shape variable inputs into names, tags, policy fragments, and resource arguments that appear clearly in Terraform plans."
tags: ["locals", "local values", "expressions", "terraform", "hcl"]
order: 6
id: article-iac-terraform-values-locals
aliases:
  - infrastructure-as-code/terraform/values/local-values.md
---

## Table of Contents

1. [What Problem Do Local Values Solve?](#what-problem-do-local-values-solve)
2. [How Are Locals Declared and Evaluated?](#how-are-locals-declared-and-evaluated)
3. [What Can a Local Depend On?](#what-can-a-local-depend-on)
4. [How Do Locals Shape Collections, Tags, and Policies?](#how-do-locals-shape-collections-tags-and-policies)
5. [When Does a Local Improve Readability?](#when-does-a-local-improve-readability)
6. [How Do Unknown and Sensitive Values Flow Through Locals?](#how-do-unknown-and-sensitive-values-flow-through-locals)
7. [How Do Locals Differ from Other Terraform Values?](#how-do-locals-differ-from-other-terraform-values)
8. [How Do Locals Build an Internal Module Model?](#how-do-locals-build-an-internal-module-model)
9. [Check Your Answers](#check-your-answers)

A local value gives a name to an expression so a module can reuse and explain the result. The name turns repeated interpolation into an internal concept with an explicit place in Terraform's value graph.

Suppose several resources repeat the same naming expression:

```hcl
resource "aws_instance" "api" {
  tags = {
    Name = "${var.project}-${var.environment}-api"
  }
}

resource "aws_instance" "worker" {
  tags = {
    Name = "${var.project}-${var.environment}-worker"
  }
}

resource "aws_s3_bucket" "logs" {
  tags = {
    Name = "${var.project}-${var.environment}-logs"
  }
}
```

Terraform can evaluate the repeated text, but people must keep every copy consistent. A change from `payments-prod-api` to `company-payments-prod-api` requires locating every version of the naming rule. The expression deserves one name:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"
}
```

Consumers can now use the result:

```hcl
resource "aws_instance" "api" {
  tags = {
    Name = "${local.name_prefix}-api"
  }
}

resource "aws_instance" "worker" {
  tags = {
    Name = "${local.name_prefix}-worker"
  }
}

resource "aws_s3_bucket" "logs" {
  tags = {
    Name = "${local.name_prefix}-logs"
  }
}
```

Keep these questions in view as you work through the lesson:

1. **What Problem Do Local Values Solve?**
2. **How Are Locals Declared and Evaluated?**
3. **What Can a Local Depend On?**
4. **How Do Locals Shape Collections, Tags, and Policies?**
5. **When Does a Local Improve Readability?**
6. **How Do Unknown and Sensitive Values Flow Through Locals?**
7. **How Do Locals Differ from Other Terraform Values?**
8. **How Do Locals Build an Internal Module Model?**

## What Problem Do Local Values Solve?

This removes repetition, but shortening code is not the deepest benefit. `local.name_prefix` tells a reader what the interpolation means. The module has turned a raw expression into a named internal concept.

![Locals normalize caller inputs into reusable internal concepts](/content-assets/articles/article-iac-terraform-values-locals/locals-normalization.png)

Variables and locals sit on opposite sides of a module boundary:

```text
variable
= someone outside the module chooses a fundamental value

local
= the module derives or defines a value for itself
```

Given `project = "payments"` and `environment = "prod"`, the caller should not also have to calculate `name_prefix = "payments-prod"`. The module can enforce its naming convention:

```text
caller inputs
project + environment
          │
          ▼
module expression
          │
          ▼
local.name_prefix
          │
          ▼
resources
```

Thinking of a local as an intermediate result in a function is helpful. The inputs enter through variables, the function computes `name_prefix`, and multiple operations use it. In Terraform, however, the result is a named expression in a dependency graph rather than a mutable temporary stored during sequential execution.

## How Are Locals Declared and Evaluated?

The declaration block is plural:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"
}
```

The reference namespace is singular:

```hcl
local.name_prefix
```

That `locals`/`local` distinction is a common beginner typo. A block can define many values with different types:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
  }

  is_production = var.environment == "prod"

  instance_count = local.is_production ? 3 : 1
}
```

This creates a string, an object or map, a boolean, and a number. The right-hand side can be any suitable Terraform expression, including literals, collections, conditionals, functions, variables, data-source results, resource attributes, or other locals.

Multiple `locals` blocks in the same module share the same module-local namespace:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"
}

locals {
  common_tags = {
    Project = var.project
  }
}
```

They are not private scopes. A team can organize definitions in `locals.tf`, `network.tf`, or other files without changing their reach within the module.

Locals cannot be reassigned. This is invalid thinking:

```text
local.count starts at 1
then local.count changes to 2
```

A declaration defines a relationship:

```hcl
locals {
  instance_count = var.environment == "prod" ? 3 : 1
}
```

`local.instance_count` always means the result of that expression for the current evaluation. It is a named node, not a storage slot whose content changes over time.

Terraform also does not execute definitions from top to bottom. This order is resolvable:

```hcl
locals {
  full_name   = "${local.name_prefix}-api"
  name_prefix = "${var.project}-${var.environment}"
}
```

The references reveal that `full_name` depends on `name_prefix`. A cycle cannot be resolved:

```hcl
locals {
  a = local.b
  b = local.a
}
```

Neither value has a starting point. Terraform's expression graph must be acyclic, regardless of the line order or number of `locals` blocks.

## What Can a Local Depend On?

The most common inputs to a local are module variables:

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

Here the caller owns the fundamental facts, while the module owns their consequence. That separation lets the module change how names are assembled without making every caller repeat the rule.

A local can also use a data source:

```hcl
data "aws_vpc" "shared" {
  # lookup criteria
}

locals {
  network_metadata = {
    id         = data.aws_vpc.shared.id
    cidr_block = data.aws_vpc.shared.cidr_block
  }
}
```

The provider reads an external VPC, and the local packages two discovered attributes into a useful internal object. The local itself performs no query; it names an expression whose dependency includes the data source.

Resource attributes can feed locals too:

```hcl
resource "aws_instance" "web" {
  # ...
}

locals {
  server_address = aws_instance.web.private_ip
}
```

If the private IP will be assigned only when the provider creates the server, `local.server_address` is unknown during planning. Placing the expression in a `locals` block near the top of a file does not evaluate it early. Terraform sees the edge:

```text
aws_instance.web.private_ip
              │
              ▼
local.server_address
```

The resource must produce the value before the local can resolve. File position does not reverse the dependency.

Once declared, a local can feed any compatible expression context:

```hcl
resource "aws_instance" "api" {
  tags = {
    Name = "${local.name_prefix}-api"
  }
}

resource "aws_s3_bucket" "logs" {
  bucket = "${local.name_prefix}-logs"
}

resource "aws_security_group" "app" {
  name = "${local.name_prefix}-sg"
}
```

The same named node can feed resources, data-source arguments, module arguments, outputs, and other locals. Terraform preserves every reference as part of the graph. A local does not detach a value from its origin; it gives that stage of the calculation a readable name.

## How Do Locals Shape Collections, Tags, and Policies?

Locals are especially valuable for normalizing or combining caller input. Common tags are one example:

```hcl
variable "additional_tags" {
  type    = map(string)
  default = {}
}

locals {
  required_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
  }

  all_tags = merge(
    var.additional_tags,
    local.required_tags,
  )
}
```

Resources can use `local.all_tags` instead of repeating project, environment, and management metadata. The merge order also expresses policy: required tags appear later, so they win if the caller supplies a conflicting key. Inputs do not have to map directly onto provider arguments; the module can interpret and constrain them.

A local can hold a reusable or derived list:

```hcl
locals {
  application_ports = var.enable_admin_port
    ? [80, 443, 8080]
    : [80, 443]
}
```

The caller chooses a fundamental boolean. The module derives the concrete collection of ports. A richer local can model multiple internal services:

```hcl
locals {
  services = {
    api = {
      port          = 8080
      instance_type = "t3.small"
    }

    worker = {
      port          = 9090
      instance_type = "t3.medium"
    }

    scheduler = {
      port          = 7070
      instance_type = "t3.micro"
    }
  }
}
```

That internal data model works naturally with `for_each`:

```hcl
resource "aws_instance" "service" {
  for_each = local.services

  instance_type = each.value.instance_type

  tags = {
    Name = "${local.name_prefix}-${each.key}"
  }
}
```

One expression now describes the service set, while each key creates a stable resource instance address.

Structured policy documents are another strong use. Terraform objects are easier to combine than a manually escaped JSON string:

```hcl
locals {
  read_actions = [
    "s3:GetObject",
    "s3:GetObjectVersion",
  ]

  asset_resources = [
    "${aws_s3_bucket.assets.arn}/*",
  ]

  bucket_read_policy = {
    Version = "2012-10-17"

    Statement = [
      {
        Effect   = "Allow"
        Action   = local.read_actions
        Resource = local.asset_resources
      }
    ]
  }
}
```

The resource can call:

```hcl
policy = jsonencode(local.bucket_read_policy)
```

The value graph is explicit: resource ARN and action list feed the policy object, `jsonencode` converts that object to a JSON string, and the provider argument consumes the result. Naming the meaningful pieces can make a large policy easier to review, provided the pieces do not become an indirection maze.

The common-tag example is worth viewing before and after normalization. Without a local, each resource repeats the same policy:

```hcl
resource "aws_instance" "api" {
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    Team        = var.team
  }
}

resource "aws_instance" "worker" {
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    Team        = var.team
  }
}

resource "aws_s3_bucket" "logs" {
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    Team        = var.team
  }
}
```

That is not only typing duplication. It duplicates an organizational rule: every managed resource must carry this metadata. A local turns the rule into one reviewable value:

```hcl
locals {
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    Team        = var.team
  }
}

resource "aws_instance" "api" {
  tags = local.common_tags
}

resource "aws_instance" "worker" {
  tags = local.common_tags
}

resource "aws_s3_bucket" "logs" {
  tags = local.common_tags
}
```

Adding a required tag once now changes every consumer. The name `common_tags` also tells a reviewer that the map is shared policy, not an accidental set of repeated strings.

Collections follow the same pattern whether they are fixed or conditional. A module may define:

```hcl
locals {
  application_ports = [
    80,
    443,
    8080,
  ]
}
```

or derive the collection from a caller choice:

```hcl
locals {
  application_ports = var.enable_admin_port
    ? [80, 443, 8080]
    : [80, 443]
}
```

In the second version, the variable expresses the allowed decision—whether the administrative endpoint is enabled—while the local owns which port that decision adds. That keeps provider-facing detail inside the module.

A rich object can be useful even without `for_each`:

```hcl
locals {
  services = {
    api = {
      port     = 8080
      replicas = 3
    }

    worker = {
      port     = 9090
      replicas = 2
    }
  }
}
```

Expressions such as `local.services.api.port` and `local.services.worker.replicas` expose typed pieces of an internal configuration model. The local is not limited to one scalar constant; it can name any Terraform value structure that makes downstream expressions clearer.

![Derived strings, collections, objects, and policies can all become local values](/content-assets/articles/article-iac-terraform-values-locals/derived-values-map.png)

## When Does a Local Improve Readability?

Every local adds a name, but also adds a step the reader may need to follow. This definition may be unnecessary:

```hcl
locals {
  port = 443
}

resource "something" "app" {
  port = local.port
}
```

If `443` appears once and is already obvious, the local replaces a visible literal with a search for its definition. The tradeoff is:

```text
benefit: reuse, meaning, consistency, abstraction
cost:    indirection
```

The right question is not “Can Terraform put this in a local?” Almost any expression can be named. Ask whether the name makes configuration easier to understand, maintain, or keep consistent.

Useful locals often represent a real concept:

```hcl
locals {
  is_production = var.environment == "prod"
}
```

Consumers can now express production policy:

```hcl
instance_type        = local.is_production ? "m7i.large" : "t3.micro"
backup_retention_days = local.is_production ? 30 : 7
```

`is_production` explains the repeated condition better than copying `var.environment == "prod"`. Similarly, `common_tags`, `name_prefix`, `minimum_ha_instance_count`, a service map, or a policy object can communicate an architectural idea.

Avoid chains that merely rename the same value:

```hcl
locals {
  is_prod = var.environment == "prod"
}

locals {
  large_environment = local.is_prod
}

locals {
  use_large_instance = local.large_environment
}
```

A reader must traverse three names to rediscover one boolean. A single `local.is_production` is clearer. A good local usually meets at least one of these tests:

- The expression repeats, and one definition prevents drift.
- The result is derived, so the caller should not calculate it.
- The expression is complex enough that a meaningful name improves its consumers.
- The value represents an architectural concept.
- The result is a useful intermediate list, map, object, or policy structure.

A local is often unnecessary when it merely renames a simple value used once, hides an obvious literal, or creates several layers of indirection. Use locals deliberately; a configuration full of tiny aliases can become a scavenger hunt.

You can apply the heuristic during review with a few concrete tests. First, search for the expression's consumers. Repetition across several resources usually favors one named definition, especially when a future policy change must reach every consumer together. Second, read the proposed name without its expression. A name such as `required_tags` or `is_production` explains intent; a name such as `value_1` does not. Third, count how many references a reader must follow. One meaningful intermediate step may clarify a complex policy, while three aliases for the same boolean conceal it.

Fourth, ask whether the value belongs to the public module contract. If the module can derive it from inputs it already has, exposing it as another variable makes every caller repeat internal knowledge. A local keeps the rule centralized. If callers genuinely own the decision, hiding it in a local would make the module inflexible; use a variable instead.

Fifth, check whether the local represents data structure rather than just abbreviation. A map of service definitions can drive `for_each`, a policy object can be encoded once, and a normalized tag map can establish precedence between caller additions and required metadata. Those structures give resources a clearer input model. By contrast, renaming `443` to `local.port` for one use only adds navigation.

Finally, review the resulting plan and source together. The plan should reveal the intended infrastructure consequences, while the local names should make it easy to trace how those values were derived. If a surprising planned value requires following a long chain of locals with no new meaning at each step, collapse the chain. If the same complex expression appears throughout the plan's source paths, introduce a meaningful node. The goal is not the maximum or minimum number of locals; it is a graph that humans can follow reliably.

This balance also improves change safety. A naming rule, required-tag policy, or production-capacity decision has one definition, so a reviewer can understand the full effect of editing it. Consumers continue to reference the concept instead of carrying copies of its implementation. At the same time, keeping simple one-use values inline preserves local context. Good Terraform source lets a reader move from caller inputs, through a small number of meaningful derivations, to planned resource arguments without guessing where a value came from or who was supposed to control it.

That traceable value flow is the practical purpose of local values.

It turns internal calculations into an understandable module model.

That model remains derived, scoped, and reusable.

It is also dependency-aware and recomputable.

That is the local-value boundary.

The plan provides another readability test. Terraform normally shows the final resource consequence rather than a separate inventory of locals:

```hcl
locals {
  instance_type = var.environment == "prod"
    ? "m7i.large"
    : "t3.micro"
}

resource "aws_instance" "web" {
  instance_type = local.instance_type
}
```

With `environment = "prod"`, the plan shows the resource using `m7i.large`. The local has already served its purpose by making the source calculation understandable. It is not an independently planned infrastructure object.

## How Do Unknown and Sensitive Values Flow Through Locals?

A local's knowledge status follows its dependencies. When both inputs are known:

```hcl
locals {
  prefix = "${var.project}-${var.environment}"
}
```

`payments` and `prod` produce a known `payments-prod` during planning. When a local depends on a provider-computed attribute:

```hcl
resource "aws_instance" "web" {
  # ...
}

locals {
  private_ip = aws_instance.web.private_ip
  endpoint   = "http://${local.private_ip}:8080"
}
```

the uncertainty propagates:

```text
aws_instance.web.private_ip = unknown
               │
               ▼
local.private_ip            = unknown
               │
               ▼
local.endpoint              = unknown
```

Terraform still knows the references and dependency order. A local neither invents a value nor breaks the edge; it names an intermediate step that will resolve after the provider supplies the IP.

Locals also preserve sensitivity. Suppose:

```hcl
variable "password" {
  type      = string
  sensitive = true
}

locals {
  connection_string = "postgres://admin:${var.password}@db.example.com"
}
```

The connection string depends on sensitive information. Terraform propagates the sensitive marking through the expression. More importantly, if `local.connection_string` is assigned to a resource attribute that Terraform persists, the actual value may enter state.

This distinction prevents a dangerous misconception:

```text
true:
a local is not an independently managed state object

false conclusion:
values passing through locals cannot be stored in state
```

Locals are transformations, not security boundaries. They do not perform CRUD operations and have no remote identity, but their results can flow into managed objects, outputs, or other persistent data. Protect the original input and every destination where the result can be recorded.

These two propagation rules—unknownness and sensitivity—show what a local really is. It is not a detached constant. It is a named expression whose characteristics and dependencies continue through the graph.

The distinction between expression evaluation and resource management also explains state. Terraform does not need create, read, update, or delete operations for `local.name_prefix`. If its inputs are `payments` and `prod`, Terraform can recompute `payments-prod` whenever it evaluates the module. There is no provider ID and no remote object bound to the local.

That does not mean the result can never appear in persistent data. If a local supplies a tag, connection string, policy, or another resource argument, the provider may return that value as part of the managed resource state. The local itself has no state identity, but its evaluated content can become part of another object's recorded attributes. This is why a sensitive input remains sensitive after interpolation and why state protection cannot be skipped.

Plans show the same boundary. Given:

```hcl
variable "environment" {
  type = string
}

locals {
  instance_type = var.environment == "prod"
    ? "m7i.large"
    : "t3.micro"
}

resource "aws_instance" "web" {
  instance_type = local.instance_type
}
```

and `environment = "prod"`, evaluation proceeds through `var.environment`, then `local.instance_type`, and finally the resource argument. The plan normally presents the useful consequence:

```text
+ resource "aws_instance" "web" {
    + instance_type = "m7i.large"
  }
```

It does not need a separate planned object for `local.instance_type`. The local has already made the source readable and delivered its value to the desired resource configuration.

## How Do Locals Differ from Other Terraform Values?

Several Terraform constructs produce values, but they differ in origin, ownership, and scope.

An input variable says:

```hcl
var.environment
```

“Someone outside this module supplied this value.” A local says:

```hcl
local.name_prefix
```

“This module named or calculated this value.” If the caller should decide `name_prefix`, make it a variable. If callers choose `project` and `environment` while the module owns the naming rule, derive it as a local. The architectural question is who owns the decision.

A data source says:

```hcl
data.aws_vpc.shared.id
```

“Terraform asked an external system for this value.” A local does not query AWS, Azure, Kubernetes, GitHub, or another API. It evaluates an expression from values Terraform already has, though that expression can depend on a data-source result.

A resource attribute says:

```hcl
aws_instance.web.id
```

“This value came from infrastructure Terraform manages.” A local may package resource attributes with calculated information:

```hcl
locals {
  server_reference = {
    name = "${var.project}-${var.environment}"
    id   = aws_instance.web.id
  }
}
```

The local remains a calculation; `aws_instance.web` remains the lifecycle-managed object.

An output crosses a module boundary:

```hcl
locals {
  application_name = "${var.project}-${var.environment}"
}

output "application_name" {
  value = local.application_name
}
```

The local serves consumers inside the module. The output deliberately exposes a result to the parent module, root caller, or CLI. A parent cannot directly reach into a child's `local.application_name`; locals are scoped to the module where they are declared. The child must publish the value through an output.

The complete origin model is:

| Construct | First-principles meaning |
| --- | --- |
| Input variable | An outside caller supplied the value |
| Local | This module derived or named the value |
| Data source | Terraform discovered the value from an external system |
| Resource attribute | A managed remote object produced the value |
| Child module output | Another module deliberately exposed the value |
| Output block | This module makes a value available outside |

Values can move through these categories according to references. A variable may feed a local, which supplies a data-source query, whose result configures a resource. A resource attribute can feed another local, which an output publishes. The constructs are not stages that must always occur in one order; their edges form the actual graph.

Module scope makes the local/output difference concrete. Imagine:

```text
root/
├── main.tf
└── modules/
    └── web/
        └── main.tf
```

Inside `modules/web`, the child can declare:

```hcl
locals {
  application_name = "${var.project}-${var.environment}"
}
```

Every file in that child module can use `local.application_name`, but the root cannot reach through the module boundary with the same reference. `local.application_name` in the root would mean a root-local value of that name, not the child's internal calculation.

If the parent needs the result, the child publishes it:

```hcl
output "application_name" {
  value = local.application_name
}
```

The parent can then use:

```hcl
module.web.application_name
```

The flow is explicit:

```text
child variables
      │
      ▼
child local
      │
      ├──► child resources
      │
      ▼
child output
      │
──── module boundary ────
      │
      ▼
parent expression
```

This preserves encapsulation. A module may reorganize its locals without breaking callers as long as its documented inputs and outputs remain compatible. Locals are implementation names; outputs are public results.

Data sources and resources also differ from locals operationally. A data source asks a provider to read an external object. A resource participates in create, read, update, and delete behavior and has a state binding to remote identity. A local performs neither remote lookup nor lifecycle operation. If it depends on either construct, the dependency comes from the reference, not from hidden behavior in the local itself.

For example:

```hcl
data "aws_vpc" "shared" {
  # lookup criteria
}

resource "aws_instance" "web" {
  # ...
}

locals {
  deployment = {
    network_id = data.aws_vpc.shared.id
    server_id  = aws_instance.web.id
    name       = "${var.project}-${var.environment}"
  }
}
```

`local.deployment.name` may be known immediately, `network_id` depends on the provider read, and `server_id` may remain unknown until apply. One object can therefore contain fields with different origins and knowledge timing. Terraform tracks those properties through the individual expressions.

Another useful comparison is a direct input versus a derived local. If callers provide `name_prefix`, every consumer must understand and obey the naming convention. If callers provide `project` and `environment`, the module can create the prefix consistently. Conversely, if organizations legitimately require different naming schemes that the module is intended to support, the boundary may need an input. Choosing between a variable and a local is an API-design decision, not a syntax preference.

The same origin test helps when a value looks constant. A fixed `443` used once may be clearest inline. A `minimum_ha_instance_count` used by several resources captures a module policy. A VPC ID already managed by another configuration should come through a data source or module output rather than be disguised as a calculated local. Naming does not change the source or ownership of information.

Finally, a local may feed an output without feeding a resource at all:

```hcl
locals {
  deployment_label = upper("${var.project}-${var.environment}")
}

output "deployment_label" {
  value = local.deployment_label
}
```

Terraform calculates a value and exposes it, but it still creates no remote object for the local. This reinforces the separation between the expression graph and the infrastructure lifecycle graph: they connect through arguments and attributes, but they are not the same set of nodes.

## How Do Locals Build an Internal Module Model?

Consider a reusable application module. The caller owns four inputs:

```hcl
variable "project" {
  type = string
}

variable "environment" {
  type = string

  validation {
    condition = contains(
      ["dev", "staging", "prod"],
      var.environment
    )

    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "team" {
  type = string
}

variable "additional_tags" {
  type    = map(string)
  default = {}
}
```

The module owns naming, required metadata, and its interpretation of production availability:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"

  is_production = var.environment == "prod"

  instance_count = local.is_production ? 3 : 1

  required_tags = {
    Project     = var.project
    Environment = var.environment
    Team        = var.team
    ManagedBy   = "Terraform"
  }

  all_tags = merge(
    var.additional_tags,
    local.required_tags,
  )
}
```

Resources consume that internal model:

```hcl
resource "aws_instance" "web" {
  count = local.instance_count

  ami           = "ami-123456"
  instance_type = local.is_production ? "m7i.large" : "t3.micro"

  tags = merge(
    local.all_tags,
    {
      Name = "${local.name_prefix}-web-${count.index + 1}"
    }
  )
}
```

Suppose the caller supplies:

```hcl
project     = "payments"
environment = "prod"
team        = "platform"

additional_tags = {
  CostCentre = "CC-1234"
}
```

Terraform derives each concept. `local.name_prefix` becomes `payments-prod`. The production test becomes true, so `local.instance_count` becomes `3` and the resource chooses `m7i.large`. Required tags become:

```hcl
{
  Project     = "payments"
  Environment = "prod"
  Team        = "platform"
  ManagedBy   = "Terraform"
}
```

Merging the caller's map adds `CostCentre = "CC-1234"`. Three addressed resources receive names ending in `web-1`, `web-2`, and `web-3`.

It helps to walk through the evaluation without skipping any intermediate values. The caller's data first enters the module as:

```text
var.project         = "payments"
var.environment     = "prod"
var.team            = "platform"
var.additional_tags = { CostCentre = "CC-1234" }
```

The naming expression combines the first two inputs:

```text
"${var.project}-${var.environment}"
            │
            ▼
     "payments-prod"
            │
            ▼
 local.name_prefix
```

The production comparison evaluates independently:

```text
"prod" == "prod"
        │
        ▼
       true
        │
        ▼
local.is_production
```

That boolean feeds a conditional rather than requiring the caller to choose a count directly:

```text
local.is_production ? 3 : 1
             │
             ▼
             3
             │
             ▼
 local.instance_count
```

The module can therefore change its definition of production availability in one place. If its policy later requires five instances, the caller still supplies the fundamental fact `environment = "prod"`; it does not need to learn or duplicate the implementation rule.

Tag evaluation combines two ownership domains. The caller contributes:

```hcl
{
  CostCentre = "CC-1234"
}
```

The module derives and requires:

```hcl
{
  Project     = "payments"
  Environment = "prod"
  Team        = "platform"
  ManagedBy   = "Terraform"
}
```

`merge` produces the final `local.all_tags` value. Because the required map is the later argument, a conflicting caller value cannot override the module's required meaning for those keys. This is an example of transforming input rather than forwarding it unchanged.

The resource's `count` consumes `local.instance_count`, creating:

```text
aws_instance.web[0]
aws_instance.web[1]
aws_instance.web[2]
```

Each resource receives the production instance type, the combined tags, and a name calculated from `local.name_prefix` plus `count.index + 1`. A plan can therefore show something like:

```text
# aws_instance.web[0] will be created
+ resource "aws_instance" "web" {
    + instance_type = "m7i.large"

    + tags = {
        + "CostCentre"  = "CC-1234"
        + "Environment" = "prod"
        + "ManagedBy"   = "Terraform"
        + "Name"        = "payments-prod-web-1"
        + "Project"     = "payments"
        + "Team"        = "platform"
      }
  }

# aws_instance.web[1] will be created
...

# aws_instance.web[2] will be created
...
```

What the plan omits as independent objects is just as revealing:

```text
local.name_prefix
local.is_production
local.instance_count
local.required_tags
local.all_tags
```

Those nodes have already contributed to the resource calculation. They matter greatly for understanding the module's logic, but they have no remote lifecycle of their own.

The source order is less important than the dependency graph:

```text
var.project ───────────────┐
                          ├──► local.name_prefix
var.environment ──────────┘
        │
        ├──► local.is_production
        │               │
        │               ▼
        │       local.instance_count
        │
var.team ───────────────┐
                       ├──► local.required_tags
var.project ────────────┤
var.environment ────────┘
                            ┌──► local.all_tags
var.additional_tags ────────┤
local.required_tags ────────┘
                                  │
                                  ▼
                           aws_instance.web
```

The plan focuses on the three intended instances, their types, names, and tags. It does not present `local.name_prefix`, `local.is_production`, or `local.all_tags` as independent objects, because they are intermediate results in evaluating those resources.

![Locals name the internal nodes between module inputs and resource configuration](/content-assets/articles/article-iac-terraform-values-locals/locals-summary.png)

This example captures the deepest model: a local is a named node in Terraform's expression graph. Its dependencies may be variables, functions, data sources, managed-resource attributes, or other locals. Its consumers may be resources, modules, data-source arguments, outputs, or further expressions. It creates no remote object, owns no independent lifecycle, and cannot make an unknown input known. Its purpose is to let the module express one internal concept once and reuse it without handing that decision to the caller.

Locals are evaluated expressions, not mutable variables or stored intermediate resources. Use them to give one meaning a name, normalize repeated inputs, and construct consistent tags, names, or object shapes. If a local merely renames a value once, it can add indirection without clarity; if callers need to choose it, it may belong as an input; if other configurations need it, it may belong as an output. Good locals make data flow easier to read while keeping the final provider arguments deterministic and visible in the plan.

Locals do not become independently managed state entries. Terraform evaluates them while constructing the graph, and the resulting values can still appear in a plan or be persisted inside resource attributes and outputs. Review the plan when a local combines sensitive or environment-specific inputs; renaming a local changes an internal expression name, not a remote resource address by itself.

## Check Your Answers

:::expand[What Problem Do Local Values Solve?]{kind="recap"}
Locals replace repeated or opaque expressions with named internal concepts. Variables carry caller decisions; locals capture values the module derives or defines for itself.
:::

:::expand[How Are Locals Declared and Evaluated?]{kind="recap"}
Declare values inside one or more `locals` blocks and reference them through `local.<name>`. They are immutable expressions evaluated by dependency relationships, not top-to-bottom assignments.
:::

:::expand[What Can a Local Depend On?]{kind="recap"}
A local can use variables, functions, data-source results, resource attributes, and other locals. It preserves every dependency rather than changing the order or origin of those values.
:::

:::expand[How Do Locals Shape Collections, Tags, and Policies?]{kind="recap"}
Locals can normalize inputs, merge required and caller tags, derive lists, model service maps for `for_each`, and assemble structured policies before encoding them for providers.
:::

:::expand[When Does a Local Improve Readability?]{kind="recap"}
Use a local when reuse, derivation, complexity, or conceptual meaning outweighs the cost of indirection. Avoid one-use aliases and long chains that turn reading into a scavenger hunt.
:::

:::expand[How Do Unknown and Sensitive Values Flow Through Locals?]{kind="recap"}
Unknownness and sensitivity propagate through local expressions. A local cannot invent an unavailable value, and it is not a security boundary even though it is not independently stored as a managed object.
:::

:::expand[How Do Locals Differ from Other Terraform Values?]{kind="recap"}
Variables come from callers, data sources read external systems, resource attributes come from managed objects, locals calculate internal values, and outputs expose results beyond a module.
:::

:::expand[How Do Locals Build an Internal Module Model?]{kind="recap"}
Thoughtful locals turn fundamental inputs into names, policies, counts, collections, and tags that resources consume. They make the module's internal value graph easier to understand and keep consistent.
:::

### References

- [Local values](https://developer.hashicorp.com/terraform/language/values/locals)
- [Types and values](https://developer.hashicorp.com/terraform/language/expressions/types)
- [Expressions](https://developer.hashicorp.com/terraform/language/expressions)
- [References to values](https://developer.hashicorp.com/terraform/language/expressions/references)
- [Terraform configuration language style guide](https://developer.hashicorp.com/terraform/language/style)
