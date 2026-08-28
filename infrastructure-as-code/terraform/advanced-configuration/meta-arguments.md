---
title: "Meta-Arguments: Controlling Resources"
description: "Learn how Terraform meta-arguments control instance identity, dependency edges, provider routing, and resource lifecycle behavior."
overview: "Resource arguments describe a remote object. Meta-arguments describe how Terraform should represent, order, route, and change that object. This article builds that distinction from first principles and follows it through count, for_each, depends_on, provider selection, lifecycle rules, and plan review."
tags: ["terraform", "meta-arguments", "lifecycle", "providers"]
order: 1
id: article-iac-terraform-config-meta-arguments
aliases:
  - infrastructure-as-code/terraform/configuration/meta-arguments.md
---

## Table of Contents

1. [What Makes an Argument a Meta-Argument?](#what-makes-an-argument-a-meta-argument)
2. [How Do count and foreach Shape Resource Identity?](#how-do-count-and-foreach-shape-resource-identity)
3. [Why Are Resource Addresses Part of the Design?](#why-are-resource-addresses-part-of-the-design)
4. [When Should You Add dependson?](#when-should-you-add-dependson)
5. [How Does Terraform Choose a Provider Configuration?](#how-does-terraform-choose-a-provider-configuration)
6. [What Can the lifecycle Block Control?](#what-can-the-lifecycle-block-control)
7. [How Do Lifecycle Conditions and Triggers Express Contracts?](#how-do-lifecycle-conditions-and-triggers-express-contracts)
8. [How Do You Review Meta-Arguments Safely?](#how-do-you-review-meta-arguments-safely)
9. [Check Your Answers](#check-your-answers)

A Terraform `resource` block mixes two kinds of instructions. Some values describe the object that a provider should request. Other values change how Terraform itself represents and manages that object. The second group can alter instance addresses, add graph edges, choose an API connection, or change the algorithm used for replacement and destruction.

These controls change Terraform's behavior rather than the remote object's ordinary arguments.

Consider one EC2 resource:

```hcl
resource "aws_instance" "app" {
  ami           = "ami-123456"
  instance_type = "t3.micro"

  count      = 3
  depends_on = [aws_iam_role_policy.app]

  lifecycle {
    create_before_destroy = true
  }
}
```

`ami` and `instance_type` describe the EC2 instance AWS should create. They are provider-specific resource arguments. `count`, `depends_on`, and `lifecycle` instead tell Terraform how many managed instances to represent, which otherwise-hidden relationship to add to its graph, and how to order a replacement. Those are meta-arguments: Terraform-language controls that sit above the provider object's ordinary settings.

Keep these questions in view as you work through the lesson:

1. **What Makes an Argument a Meta-Argument?**
2. **How Do `count` and `for_each` Shape Resource Identity?**
3. **Why Are Resource Addresses Part of the Design?**
4. **When Should You Add `depends_on`?**
5. **How Does Terraform Choose a Provider Configuration?**
6. **What Can the `lifecycle` Block Control?**
7. **How Do Lifecycle Conditions and Triggers Express Contracts?**
8. **How Do You Review Meta-Arguments Safely?**

## What Makes an Argument a Meta-Argument?
<!-- section-summary: Provider arguments define remote objects, while meta-arguments control Terraform's representation and management of those objects. -->

```text
provider argument
    describes the requested remote object

meta-argument
    describes Terraform's relationship with that object
```

Terraform is not simply running blocks from top to bottom. It converts configuration into a graph of resource instances, associates those instances with addresses in state, routes operations through configured providers, and chooses create, update, replace, or destroy actions. A plain resource might have the address:

```text
aws_instance.app
```

State uses that address to associate configuration with a real object such as an EC2 instance ID. Meta-arguments can change the graph around that address or even expand one block into several addresses.

![Count and for_each expansion](/content-assets/articles/article-iac-terraform-config-meta-arguments/count-foreach-expansion.png)

*Repetition controls turn one resource block into multiple independently managed resource instances.*

The major controls divide naturally:

| Control | Question it answers |
|---|---|
| `count`, `for_each` | How many instances exist, and what identifies each one? |
| `depends_on` | Which hidden dependency edge must Terraform add? |
| `provider` | Which configured API connection performs this operation? |
| `lifecycle` | Which rules modify normal create, replace, and destroy behavior? |

Their values must generally be usable while Terraform is constructing its graph. For example, the number of `count` instances cannot depend on an ID that a provider will reveal only during apply. Terraform needs to know the graph's shape before it begins remote operations.

This graph-first view is the foundation for every later example. Meta-arguments control node count and identity, edges between nodes, execution destination, and management policy. The provider arguments still determine what each remote node should be like.

## How Do `count` and `for_each` Shape Resource Identity?
<!-- section-summary: count assigns positional identity, while for_each assigns identity from stable keys. -->

Suppose three nearly identical servers are required. Writing three resource blocks repeats the same configuration, so `count` can expand one block:

```hcl
resource "aws_instance" "app" {
  count = 3

  ami           = "ami-123"
  instance_type = "t3.micro"

  tags = {
    Name = "app-${count.index}"
  }
}
```

The block is named `aws_instance.app`, but the managed instances have indexed addresses:

```text
aws_instance.app[0]
aws_instance.app[1]
aws_instance.app[2]
```

`count.index` exposes the current zero-based position. This model works well when instances are genuinely interchangeable and the meaningful requirement is simply a number. It also supports an on/off pattern:

```hcl
resource "aws_instance" "debug" {
  count = var.enable_debug_server ? 1 : 0

  ami           = "ami-123"
  instance_type = "t3.micro"
}
```

When the condition is true, the address is `aws_instance.debug[0]`; when false, there is no instance. Because the block is counted even when its maximum size is one, downstream references must account for the indexed shape.

The deeper limitation is positional identity. Imagine a list containing `api`, `worker`, and `metrics`:

```hcl
variable "servers" {
  default = ["api", "worker", "metrics"]
}

resource "aws_instance" "server" {
  count = length(var.servers)

  ami = "ami-123"

  tags = {
    Name = var.servers[count.index]
  }
}
```

Terraform identifies the members as `[0]`, `[1]`, and `[2]`, not by the tag text. Removing `worker` changes the value at index 1 from `worker` to `metrics` and removes index 2. The human domain model says that one named server disappeared, but the positional address model says that later positions changed.

When names are the durable identities, `for_each` represents them directly:

```hcl
resource "aws_instance" "server" {
  for_each = toset(["api", "worker", "metrics"])

  ami           = "ami-123"
  instance_type = "t3.micro"

  tags = {
    Name = each.key
  }
}
```

The addresses now contain keys:

```text
aws_instance.server["api"]
aws_instance.server["worker"]
aws_instance.server["metrics"]
```

Removing `worker` removes only the `"worker"` address. The other identities remain stable. Maps can attach a different object to every key:

```hcl
locals {
  servers = {
    api = {
      instance_type = "m7i.large"
      replicas      = 3
    }
    worker = {
      instance_type = "c7i.large"
      replicas      = 6
    }
    metrics = {
      instance_type = "t3.medium"
      replicas      = 1
    }
  }
}

resource "aws_instance" "server" {
  for_each = local.servers

  ami           = "ami-123"
  instance_type = each.value.instance_type

  tags = {
    Name = each.key
  }
}
```

`each.key` supplies the persistent name and `each.value` supplies that member's settings. A block cannot use `count` and `for_each` together. Choose between them by asking what should make Terraform believe an object today is the same object tomorrow. A numeric position suits indistinguishable capacity; a meaningful stable key suits regions, roles, teams, or named network segments.

## Why Are Resource Addresses Part of the Design?
<!-- section-summary: Repetition changes state addresses, so changing identity models requires an explicit state-aware migration. -->

A Terraform address is not just a convenient label in a plan. It is the configuration-side identity that state associates with a remote object. Changing the address can therefore look like removing one managed object and declaring another.

Suppose a resource begins without repetition:

```hcl
resource "aws_instance" "app" {
  ami = "ami-123"
}
```

Its address is `aws_instance.app`. Later, the block is converted to a keyed collection:

```hcl
resource "aws_instance" "app" {
  for_each = {
    primary = {}
  }

  ami = "ami-123"
}
```

The new address is `aws_instance.app["primary"]`. The provider object may be intended to stay exactly where it is, but Terraform sees an old address disappearing and a new address appearing unless the refactor includes migration information.

A `moved` block records that the identity changed inside configuration while the remote object should remain associated with the new address:

```hcl
moved {
  from = aws_instance.app
  to   = aws_instance.app["primary"]
}
```

Moved declarations can also help migrations involving `count`, `for_each`, renamed resources, and module addresses. They make an address refactor explicit rather than asking reviewers to infer it from a destroy-and-create plan.

The same concern applies to key changes. Renaming a `for_each` key normally removes the old instance address and introduces a new one. If the domain object itself was renamed and must be replaced, that may be correct. If only configuration vocabulary changed, a move can preserve its state identity.

Address review should be a deliberate design activity:

```text
count value changes
list insertion or deletion
for_each key changes
resource or module label changes
plain resource to count or for_each
count to for_each
```

Every item can affect what state believes exists. Before applying, read the addresses in the plan and verify that unchanged domain objects retain unchanged state identities. If several unrelated objects appear to shift, stop and investigate the collection or address transformation.

This is why choosing `count` or `for_each` is more than choosing loop syntax. It chooses the public shape through which outputs, dependencies, state commands, imports, and future migrations will refer to the managed instances.

## When Should You Add `depends_on`?
<!-- section-summary: Terraform infers dependencies from value references; depends_on is reserved for real relationships that data flow cannot express. -->

Terraform normally discovers ordering through expressions. A subnet that consumes a VPC ID already depends on the VPC:

```hcl
resource "aws_subnet" "app" {
  vpc_id = aws_vpc.main.id
}
```

The value reference tells Terraform both what data the subnet requires and why the VPC must be handled first. No explicit `depends_on` is needed. More broadly, when resource B consumes an attribute from resource A, Terraform adds an edge from B to A in its graph.

Some dependencies are behavioral rather than data-driven. An application may need an IAM policy to be effective even though none of its resource arguments consumes a policy attribute. Terraform cannot infer that hidden relationship from the expressions, so it can be declared:

```hcl
resource "aws_instance" "app" {
  ami           = "ami-123"
  instance_type = "t3.micro"

  depends_on = [
    aws_iam_role_policy.app
  ]
}
```

This says that correct operation of the instance depends on the policy even though no value flows between the blocks. It adds the missing graph edge.

Use `depends_on` only after asking why the ordering exists. If B needs `A.id`, referencing that attribute is richer than adding an arbitrary ordering rule: it communicates the data and the dependency together. Explicit dependencies can also make plans more conservative, leaving additional values unknown until apply.

Terraform is not a procedural file that executes line 1, then line 2, then line 3. Independent graph branches may proceed in parallel:

```text
             network
             /     \
            v       v
       database   load balancer
            \       /
             v     v
           application
```

Adding unnecessary edges reduces that useful independence and hides the actual data model. `depends_on` should repair a missing relationship, not force Terraform to imitate a shell script.

The distinction is simple but important:

```text
ordinary reference
    expresses data flow and ordering

depends_on
    expresses ordering for a hidden dependency
```

If a reference can naturally express the relationship, prefer it. If the dependency is operational and invisible to configuration values, document that reasoning near the explicit edge and verify that the dependency is narrow enough.

## How Does Terraform Choose a Provider Configuration?
<!-- section-summary: The provider meta-argument routes a resource through a specific configured API context such as a region, account, role, or endpoint. -->

A default provider configuration supplies the API context for resources that do not choose another one:

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

An unqualified AWS resource uses that configuration. Systems spanning regions, accounts, roles, or endpoints can define aliases:

```hcl
provider "aws" {
  region = "eu-west-2"
}

provider "aws" {
  alias  = "us"
  region = "us-east-1"
}
```

The default is referenced as `aws`; the alias is `aws.us`. A resource can be routed through the alias with the `provider` meta-argument:

```hcl
resource "aws_instance" "dr" {
  provider = aws.us

  ami           = "ami-123"
  instance_type = "t3.micro"
}
```

`instance_type` describes what AWS should create. `provider = aws.us` determines which configured connection Terraform uses to ask. Provider references must be known while Terraform constructs the graph; this position is not an arbitrary runtime expression.

An alias can represent a security boundary as well as geography:

```hcl
provider "aws" {
  alias  = "dev"
  region = "eu-west-2"

  assume_role {
    role_arn = "arn:aws:iam::111111111111:role/Terraform"
  }
}

provider "aws" {
  alias  = "prod"
  region = "eu-west-2"

  assume_role {
    role_arn = "arn:aws:iam::999999999999:role/Terraform"
  }
}
```

```hcl
resource "aws_s3_bucket" "prod_logs" {
  provider = aws.prod
  bucket   = "acme-prod-logs"
}
```

A `prod` tag or resource label is only text. The selected provider configuration is what actually points Terraform at a production account. Review provider routing with the same care as resource arguments because a correct-looking object sent to the wrong account is still a dangerous plan.

Child modules use the related `providers` meta-argument. The caller explicitly maps provider configurations into the module, allowing its resources to use the intended contexts without defining provider credentials inside reusable module code.

```text
resource provider argument
    selects the provider configuration for one resource

module providers argument
    passes selected provider configurations into a child module
```

Treat both as dependency injection for API authority: the configuration receives an already configured connection instead of deriving credentials or account ownership from naming conventions.

## What Can the `lifecycle` Block Control?
<!-- section-summary: Lifecycle rules modify replacement order, block configured destruction, and define deliberate ownership boundaries for drift. -->

Terraform compares configuration with state and remote infrastructure, then chooses no action, create, update in place, replacement, or destroy. Provider schemas determine which properties can update and which require replacement. The `lifecycle` block modifies selected parts of that normal change algorithm.

![Create before destroy order](/content-assets/articles/article-iac-terraform-config-meta-arguments/create-before-destroy-order.png)

*Replacement order can reduce interruption only when both generations are allowed to coexist.*

`create_before_destroy` reverses the usual replacement order:

```hcl
resource "aws_instance" "app" {
  ami           = var.ami
  instance_type = "t3.micro"

  lifecycle {
    create_before_destroy = true
  }
}
```

Terraform attempts to create the replacement while the old object still exists, then remove the old object. This can reduce downtime, but it cannot override platform constraints. If both generations require the same globally unique name or there is insufficient quota or capacity, they cannot coexist. Generated names, health checks, routing behavior, and provider support remain part of the design.

`prevent_destroy` makes Terraform reject a plan that would destroy the resource while the configured guard remains:

```hcl
resource "aws_db_instance" "production" {
  # database arguments

  lifecycle {
    prevent_destroy = true
  }
}
```

This is useful for production databases, critical buckets, and persistent storage. It is a Terraform guardrail, not proof that the cloud object is indestructible. Removing the resource block also removes the lifecycle rule from ordinary configuration enforcement. Backups, provider-side deletion protection, access control, and reviewed procedures are still necessary.

`ignore_changes` assigns ownership of selected attributes to something outside Terraform:

```hcl
resource "aws_autoscaling_group" "app" {
  desired_capacity = 3

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
```

If an autoscaler adjusts capacity from 3 to 7, Terraform does not try to restore 3 solely because that attribute drifted. The design says Terraform establishes the group while the autoscaler owns its ongoing desired capacity.

![Lifecycle guardrails](/content-assets/articles/article-iac-terraform-config-meta-arguments/lifecycle-guardrails.png)

*Each lifecycle rule has a narrow purpose; it does not replace platform safeguards or operational review.*

Broad ignores are dangerous. `ignore_changes = all` can suppress meaningful drift along with noise. Before ignoring a field, name the other controller that owns it and explain why that ownership is intentional. If nobody owns the field and the goal is merely a quiet plan, the rule is hiding a problem.

These controls answer different questions:

```text
create_before_destroy
    Can a replacement be created before the old object is removed?

prevent_destroy
    Should a configured Terraform destruction fail?

ignore_changes
    Which attributes are intentionally managed elsewhere after creation?
```

They may appear in the same lifecycle block, but they do not guarantee that their combined intent is physically possible. The plan and the remote platform constraints remain decisive.

## How Do Lifecycle Conditions and Triggers Express Contracts?
<!-- section-summary: Replacement triggers, conditions, and provider actions encode relationships and assumptions that ordinary attribute changes cannot express. -->

`replace_triggered_by` couples replacement to a change elsewhere in Terraform's managed graph:

```hcl
resource "example_service" "app" {
  lifecycle {
    replace_triggered_by = [
      example_config.app
    ]
  }
}
```

This relationship differs from `depends_on`. An explicit dependency says one operation must follow another. A replacement trigger says a change to the referenced resource or attribute should cause this resource to be replaced.

```text
depends_on
    ordering relationship

replace_triggered_by
    replacement relationship
```

Terraform lifecycle conditions turn architectural assumptions into executable checks. A precondition is evaluated before Terraform operates on the object. A postcondition checks the evaluated or created result.

```hcl
lifecycle {
  precondition {
    condition     = var.environment != "prod" || var.replica_count >= 3
    error_message = "Production requires at least three replicas."
  }
}
```

The rule converts a reminder into a constraint Terraform can enforce. Production cannot proceed with fewer than three replicas even if a caller supplies that value. A postcondition can similarly require a provider result to satisfy a contract after evaluation.

Current Terraform also supports provider-defined actions and the `action_trigger` lifecycle rule. Where a provider implements an action, Terraform can trigger it around create or update events. Conceptually, a resource update emits an event and a provider action handles an operational step. This is more specialized than repetition, dependencies, routing, and classic lifecycle behavior, but it belongs to the same family: it changes what Terraform does around the managed object rather than describing a normal object property.

Meta-arguments can interact in one block:

```hcl
resource "aws_instance" "app" {
  for_each = var.app_servers

  provider = aws.prod

  ami           = each.value.ami
  instance_type = each.value.instance_type

  depends_on = [
    aws_iam_role_policy.app
  ]

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }
}
```

`for_each` chooses instances and addresses. `provider` routes them to the production API context. `depends_on` adds the hidden IAM edge. `lifecycle` changes replacement and destruction policy. `ami` and `instance_type` describe the instances themselves.

Read each layer independently before evaluating the combination. For example, `create_before_destroy` asks Terraform to create a new object, while `prevent_destroy` refuses destruction of the old one. That might intentionally require a separate controlled change, or it might create a configuration that cannot complete. A syntactically valid combination is not automatically an operationally coherent one.

## How Do You Review Meta-Arguments Safely?
<!-- section-summary: Safe review translates every meta-argument into concrete addresses, graph edges, provider contexts, and lifecycle actions in the plan. -->

The plan turns the abstractions into specific infrastructure actions. For a keyed block, verify that the plan shows the intended addresses:

```hcl
resource "aws_instance" "app" {
  for_each = {
    api     = {}
    worker  = {}
    metrics = {}
  }

  ami = "ami-123"
}
```

If `worker` is removed, the expected result is removal of `aws_instance.app["worker"]` while the `api` and `metrics` addresses remain stable. A plan that shifts or replaces several instances indicates an identity or address problem that should be understood before apply.

Use four review lenses:

| Lens | Review question |
|---|---|
| Shape and identity | Which instances and addresses exist after `count` or `for_each` expansion? |
| Dependency graph | Which relationships come from values, and which hidden edge justifies `depends_on`? |
| Destination | Which account, region, role, or endpoint does the selected provider represent? |
| Lifecycle policy | What will be created, replaced, ignored, blocked, checked, or triggered? |

A complete application-server design might say there are two named roles, both operate through the production provider, IAM policy must be ready first, and replacements should minimize interruption:

```hcl
locals {
  servers = {
    api = {
      instance_type = "m7i.large"
    }
    worker = {
      instance_type = "c7i.large"
    }
  }
}

resource "aws_instance" "app" {
  for_each = local.servers

  provider = aws.prod

  ami           = var.ami
  instance_type = each.value.instance_type

  tags = {
    Name = each.key
  }

  depends_on = [
    aws_iam_role_policy.app
  ]

  lifecycle {
    create_before_destroy = true
  }
}
```

The mental model is a graph with `app["api"]` and `app["worker"]` as separate state identities. Both use the production AWS context, both wait on the hidden IAM relationship, and both use the requested replacement order. Their ordinary arguments still define the AMI, size, and tags.

Before approval, check the practical constraints behind the language:

```text
Are all count values and for_each keys known before apply?
Do keys reflect durable domain identities?
Does an address change need a moved block?
Could an ordinary reference replace depends_on?
Does the provider alias target the intended account and region?
Can old and new resources coexist during replacement?
Which controller owns every ignored attribute?
Are prevent_destroy, backups, and provider safeguards consistent?
Do conditions state a real invariant with a useful error?
```

The concise first-principles definition is this: resource arguments describe the infrastructure object; meta-arguments describe Terraform's management relationship with it. `count` and `for_each` control shape and identity, `depends_on` controls otherwise-hidden graph edges, `provider` controls execution destination, and `lifecycle` controls management policy. Reviewing those dimensions explicitly prevents a small syntax change from becoming a surprising change to state or live infrastructure.

That review should happen again whenever collection membership, provider aliases, dependency assumptions, or lifecycle ownership materially changes. These decisions persist beyond the current apply because state records their consequences. Clear keys, narrow dependency edges, explicit API destinations, and carefully bounded lifecycle rules make later plans easier for another operator to interpret and challenge safely.

Meta-arguments change how Terraform constructs or schedules resource instances, so their blast radius is larger than an ordinary provider setting. A change from one `for_each` key scheme to another can look like deletion and creation even when the remote intent is similar; a lifecycle rule can suppress or force transitions; a dependency edge can delay unrelated work. Inspect resource addresses and action reasons in the plan whenever a meta-argument changes. The safest configuration makes instance identity and lifecycle policy explicit enough that reviewers can predict the graph before apply.

## Check Your Answers

:::expand[What Makes an Argument a Meta-Argument?]{kind="recap"}
Provider arguments describe the remote object. Meta-arguments control Terraform's graph, state identity, provider routing, and change behavior around that object.
:::

:::expand[How Do `count` and `for_each` Shape Resource Identity?]{kind="recap"}
`count` creates numeric, positional addresses. `for_each` creates keyed addresses, which usually better preserve the identity of naturally named objects.
:::

:::expand[Why Are Resource Addresses Part of the Design?]{kind="recap"}
State associates addresses with remote objects. Address changes can imply removal and creation unless a `moved` block records an intentional identity-preserving refactor.
:::

:::expand[When Should You Add `depends_on`?]{kind="recap"}
Prefer value references because they express data and ordering together. Add `depends_on` only for a real dependency that Terraform cannot infer from expressions.
:::

:::expand[How Does Terraform Choose a Provider Configuration?]{kind="recap"}
The provider meta-argument selects a configured API context such as an account, region, role, or endpoint. Module callers pass contexts through the `providers` argument.
:::

:::expand[What Can the `lifecycle` Block Control?]{kind="recap"}
Lifecycle rules can reverse replacement order, block configured destruction, or deliberately give another controller ownership of selected changing attributes.
:::

:::expand[How Do Lifecycle Conditions and Triggers Express Contracts?]{kind="recap"}
Replacement triggers model replacement coupling, conditions enforce assumptions, and supported action triggers connect resource events to provider-defined operations.
:::

:::expand[How Do You Review Meta-Arguments Safely?]{kind="recap"}
Translate the plan into concrete instance addresses, graph edges, provider destinations, and lifecycle actions, then verify that the platform can satisfy the intended combination.
:::

---

**References**

- [Terraform: Meta-arguments](https://developer.hashicorp.com/terraform/language/meta-arguments)
- [Terraform: `count`](https://developer.hashicorp.com/terraform/language/meta-arguments/count)
- [Terraform: `for_each`](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [Terraform: Refactor modules and resources](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Terraform: `depends_on`](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on)
- [Terraform: `provider`](https://developer.hashicorp.com/terraform/language/meta-arguments/provider)
- [Terraform: Module `providers`](https://developer.hashicorp.com/terraform/language/meta-arguments/providers)
- [Terraform: Resource blocks and lifecycle](https://developer.hashicorp.com/terraform/language/block/resource)
- [Terraform: Lifecycle meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)
