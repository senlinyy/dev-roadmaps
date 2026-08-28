---
title: "Loops: count and for_each"
description: "count and for_each expand one Terraform block into multiple independently tracked resource instances."
overview: "Terraform loops are declarative instance expansion, not repeated imperative execution. This article compares count's positional identity with for_each's named identity, then covers maps, sets, transformations, reference types, chaining, known-shape rules, and dynamic nested blocks."
tags: ["count", "for_each", "loops", "meta-arguments", "terraform"]
order: 2
id: article-iac-terraform-advanced-loops
---

## Table of Contents

1. [What Does Looping Mean in Terraform?](#what-does-looping-mean-in-terraform)
2. [When Does count Fit the Resource Identity?](#when-does-count-fit-the-resource-identity)
3. [Why Can Positional Identity Cause Surprising Changes?](#why-can-positional-identity-cause-surprising-changes)
4. [How Does foreach Create Named Instances?](#how-does-foreach-create-named-instances)
5. [How Do Sets, Maps, and Object Lists Become foreach Inputs?](#how-do-sets-maps-and-object-lists-become-foreach-inputs)
6. [How Do Repeated Resources Flow Through the Graph?](#how-do-repeated-resources-flow-through-the-graph)
7. [When Should You Use a dynamic Block?](#when-should-you-use-a-dynamic-block)
8. [How Do You Choose the Smallest Safe Loop?](#how-do-you-choose-the-smallest-safe-loop)
9. [Check Your Answers](#check-your-answers)

The word “loop” can be misleading. Terraform does not run a creation instruction repeatedly. It expands one declaration into several independently managed instances, gives each one a state address, and binds each address to a real object.

Three EC2 instances can begin as three explicit blocks:

```hcl
resource "aws_instance" "api" {
  ami           = "ami-123"
  instance_type = "t3.micro"
}

resource "aws_instance" "worker" {
  ami           = "ami-123"
  instance_type = "t3.micro"
}

resource "aws_instance" "metrics" {
  ami           = "ami-123"
  instance_type = "t3.micro"
}
```

Terraform sees three addresses—`aws_instance.api`, `aws_instance.worker`, and `aws_instance.metrics`—and state can bind each to a different EC2 identity. This is valid and may be clearest when the resources are genuinely different.

Conceptually, state can contain:

```text
aws_instance.api     → i-111
aws_instance.worker  → i-222
aws_instance.metrics → i-333
```

The address, not the order of blocks in the file, is Terraform's logical identity. Explicit blocks communicate three distinct roles directly. The repetition cost is that every shared setting now has three maintenance locations.

Keep these questions in view as you work through the lesson:

1. **What Does Looping Mean in Terraform?**
2. **When Does `count` Fit the Resource Identity?**
3. **Why Can Positional Identity Cause Surprising Changes?**
4. **How Does `for_each` Create Named Instances?**
5. **How Do Sets, Maps, and Object Lists Become `for_each` Inputs?**
6. **How Do Repeated Resources Flow Through the Graph?**
7. **When Should You Use a `dynamic` Block?**
8. **How Do You Choose the Smallest Safe Loop?**

## What Does Looping Mean in Terraform?
<!-- section-summary: count and for_each expand one declaration into multiple state identities rather than executing a resource block as an imperative instruction. -->

Many blocks repeating the same AMI, type, tags, and relationships create a maintenance problem. `count` and `for_each` express multiple instances from one declaration, but they assign different identities:

```text
configuration block
       ↓ expansion
resource instances
       ↓
state addresses
       ↓
remote objects
```

The code reduction is not the main design question. The main question is which address still describes each object's identity after the input changes. Numeric positions suit interchangeable copies. Stable keys suit separately named things.

This is why an imperative analogy is incomplete. In Python, a loop iteration is a moment in execution. In Terraform, expansion creates a set of persistent addresses that future plans must reconcile with the same remote objects. The loop choice becomes part of state design.

## When Does `count` Fit the Resource Identity?
<!-- section-summary: count creates a known number of indexed instances and works best when position is the real identity of interchangeable replicas. -->

Three interchangeable workers fit `count`:

```hcl
resource "aws_instance" "worker" {
  count = 3

  ami           = "ami-123"
  instance_type = "t3.micro"
}
```

Terraform expands one block into:

```text
aws_instance.worker[0]
aws_instance.worker[1]
aws_instance.worker[2]
```

Each address is independently stored in state. Inside the block, `count.index` gives the current zero-based position:

```hcl
resource "aws_instance" "worker" {
  count = 3

  ami           = "ami-123"
  instance_type = "t3.micro"

  tags = {
    Name = "worker-${count.index}"
  }
}
```

The names become `worker-0`, `worker-1`, and `worker-2`. The indexes are useful when the domain really is “N copies,” not three business identities.

A plan exposes the expansion:

```text
aws_instance.worker[0]
aws_instance.worker[1]
aws_instance.worker[2]
```

The block itself is one configuration node template; the indexed instances are the actual managed graph nodes. Provider operations and state bindings happen per instance.

A variable can control pool size:

```hcl
variable "worker_count" {
  type = number
}

resource "aws_instance" "worker" {
  count = var.worker_count

  ami           = var.worker_ami
  instance_type = "c7i.large"
}
```

Increasing from three to five adds `[3]` and `[4]`. Decreasing to two removes the highest indexes. That matches the model of interchangeable replicas.

The word “interchangeable” matters. If losing the highest-numbered workers is operationally equivalent to losing any other copies, positional identity is honest. If each instance carries a durable business role, the indexes are hiding a stronger identity that belongs in a key.

`count` can also turn a boolean into a zero-or-one collection:

```hcl
resource "aws_instance" "debug" {
  count = var.enable_debug ? 1 : 0

  ami           = "ami-123"
  instance_type = "t3.micro"
}
```

When enabled, the address is `aws_instance.debug[0]`; when disabled, no instance exists. Adding `count` changes an uncounted address into an indexed address even if the maximum is one, so existing state may need a `moved` block during that refactor.

Downstream references also change shape. A counted resource is a collection, so consumers refer to one instance by index or transform all instances with a splat or `for` expression. The zero-instance case must not blindly read `[0]` when the feature is disabled.

![Count Vs Foreach Identity](/content-assets/articles/article-iac-terraform-advanced-loops/count-vs-foreach-identity.png)

## Why Can Positional Identity Cause Surprising Changes?
<!-- section-summary: count binds identity to list position, so removing an item from the middle can change the meaning of later addresses. -->

Suppose a list contains separately named servers:

```hcl
variable "servers" {
  default = [
    "api",
    "worker",
    "metrics",
  ]
}

resource "aws_instance" "server" {
  count = length(var.servers)

  ami           = "ami-123"
  instance_type = "t3.micro"

  tags = {
    Name = var.servers[count.index]
  }
}
```

Humans see `api`, `worker`, and `metrics` as identities. State sees `[0]`, `[1]`, and `[2]`. The names are only values attached to those positions:

```text
[0] → api
[1] → worker
[2] → metrics
```

Remove `worker` and the desired list becomes `api`, `metrics`. State identity now compares like this:

```text
before: [0] api, [1] worker, [2] metrics
after:  [0] api, [1] metrics
```

Terraform does not inherently interpret that as “metrics moved.” Address `[1]` changed its desired attributes, and `[2]` disappeared. Depending on provider lifecycle rules, the result can include updates, replacements, and destruction that do not match the human idea of removing only `worker`.

A plan may show `[1]` changing from worker settings to metrics settings and `[2]` being destroyed. If a changed attribute forces replacement, the index shift can recreate metrics even though metrics was meant to survive. The loop syntax is working correctly; the chosen identity model is wrong for the domain.

The problem is not that lists are inherently unsafe. The mismatch is between positional state identity and named real-world identity. If objects are meaningfully called `api`, `worker`, and `metrics`, their Terraform addresses should usually carry those names too.

Appending to the end of a list is often harmless because existing indexes stay aligned. Inserting, removing, or reordering in the middle exposes the fragility. Review the operations the collection will experience over its lifecycle, not only its initial creation.

## How Does `for_each` Create Named Instances?
<!-- section-summary: for_each creates one instance per map key or set element, making a stable name part of the Terraform address. -->

Use a set when each string is the identity:

```hcl
resource "aws_instance" "server" {
  for_each = toset([
    "api",
    "worker",
    "metrics",
  ])

  ami           = "ami-123"
  instance_type = "t3.micro"

  tags = {
    Name = each.key
  }
}
```

Terraform creates:

```text
aws_instance.server["api"]
aws_instance.server["worker"]
aws_instance.server["metrics"]
```

Inside the block, `each.key` is the current key. For a set of strings, `each.value` is the same string. Remove `worker`, and Terraform removes only `aws_instance.server["worker"]`; the other two addresses stay stable.

The plan can now state exactly which identity leaves:

```text
aws_instance.server["worker"] will be destroyed
```

No reader has to remember what list element `[1]` represented. The address and the real role use the same language.

The difference between the two meta-arguments is therefore an identity decision:

```text
count → how many positional instances?
for_each → which named instances?
```

Use `count` when the copies are interchangeable and only the number matters. Use `for_each` when every object has a durable key whose continued identity matters during insertions and removals.

This is not a style preference between two loop spellings. Converting an established resource from `count` to `for_each` changes every address from numeric to keyed. Preserve existing objects with reviewed `moved` blocks that map each old index to the intended new key.

## How Do Sets, Maps, and Object Lists Become `for_each` Inputs?
<!-- section-summary: Sets use each string as identity, maps separate durable keys from per-instance settings, and object lists need an explicit keyed transformation. -->

`for_each` accepts a map or a set of strings. A set is appropriate when the string itself is all the identity and configuration needed:

```hcl
variable "server_names" {
  type    = set(string)
  default = ["api", "worker", "metrics"]
}
```

`toset(...)` is often used to convert a list of unique names, but the conversion discards order and duplicates. Use it only when that loss matches the intended identity model. A list index is not preserved in the resulting keys.

For example, `toset(["api", "api", "worker"])` contains only `"api"` and `"worker"`. If duplicates represent separate desired objects, a set cannot express them. If order conveys deployment priority, that ordering also does not become instance identity. Choose a collection whose semantics match the problem before feeding it to `for_each`.

Maps are more useful when instances have distinct settings:

```hcl
variable "servers" {
  type = map(object({
    instance_type = string
    subnet_id     = string
  }))

  default = {
    api = {
      instance_type = "t3.small"
      subnet_id     = "subnet-aaa"
    }
    worker = {
      instance_type = "c7i.large"
      subnet_id     = "subnet-bbb"
    }
  }
}

resource "aws_instance" "server" {
  for_each = var.servers

  ami           = var.ami
  instance_type = each.value.instance_type
  subnet_id     = each.value.subnet_id

  tags = {
    Name = each.key
  }
}
```

The key is the durable identity; the object is the changeable configuration for that identity. Choose keys such as stable service names, region codes, or logical roles. Do not use a display label that changes frequently or a value assigned by a provider after apply.

Map values can evolve without moving the address. Changing the `api` instance type updates `aws_instance.server["api"]`. Renaming the key from `api` to `public-api` removes one address and adds another unless a `moved` block declares continuity. The key behaves like a primary key, while the object fields behave like mutable row data.

A list of objects can be transformed into a map when one field is a unique key:

```hcl
variable "server_list" {
  type = list(object({
    name          = string
    instance_type = string
  }))
}

locals {
  servers_by_name = {
    for server in var.server_list : server.name => server
  }
}

resource "aws_instance" "server" {
  for_each = local.servers_by_name

  ami           = var.ami
  instance_type = each.value.instance_type
}
```

This transformation is a `for` expression; resource expansion is `for_each`. They are related but not interchangeable. The first produces a value. The second consumes a collection to create resource instances.

The transformed keys must be unique. If two objects share the same `name`, a map cannot contain both under that key. Validation or upstream normalization should protect whatever uniqueness assumption the transformation uses.

Map keys deserve design review because they appear in plans, state commands, imports, moved blocks, and outputs. A durable key should remain valid even when display text, owners, instance sizes, or provider-generated identities change.

## How Do Repeated Resources Flow Through the Graph?
<!-- section-summary: count and for_each change resource reference types, can pass keyed collections downstream, and require instance shape to be known before apply. -->

An unexpanded resource reference is an object. A resource with `count` behaves as a list or tuple of instance objects. A resource with `for_each` behaves as a map of instance objects. That shape affects every downstream expression.

Loop design is therefore not only a way to shorten configuration. It also chooses the collection shape that later resources, outputs, and modules must consume, so the identity model should match the real objects being managed over time.

For a counted resource, `aws_instance.worker[0].id` reads one object and `aws_instance.worker[*].id` reads the collection. For a keyed resource, `aws_instance.server["api"].id` reads one object and a `for` expression can preserve all keys. Consumers must use the reference type created by the loop.

For counted workers, a splat can collect IDs:

```hcl
output "worker_ids" {
  value = aws_instance.worker[*].id
}
```

For named servers, preserve keys in the output:

```hcl
output "server_ids" {
  value = {
    for name, server in aws_instance.server : name => server.id
  }
}
```

The map lets consumers retain the same identities instead of collapsing them into a fragile positional list.

`for_each` can also chain directly when one resource map defines another resource map:

```hcl
resource "aws_vpc" "environment" {
  for_each = var.networks

  cidr_block = each.value.cidr_block
}

resource "aws_internet_gateway" "environment" {
  for_each = aws_vpc.environment

  vpc_id = each.value.id
}
```

The same keys connect VPC and gateway identities. Terraform understands that corresponding instances share a key and that gateway values depend on VPC results.

Chaining is useful when the downstream instances should change keys together with the upstream map. Removing one network key then removes the corresponding gateway key without rebuilding unrelated instances. The shared key expresses the architectural relationship.

Both `count` and `for_each` must know their shape before provider operations. `count` needs a known number; `for_each` needs known keys. A provider-generated ID may be used inside an already-declared instance, but it cannot usually become a new key that Terraform discovers only during apply.

Values inside the map may remain unknown while keys are known. Terraform can plan `module` or resource instances keyed by caller-supplied names and fill their provider-returned IDs later. Separate stable configuration identity from remote identity assigned during apply.

Review collection types as part of interface design. A caller expecting one object cannot consume a counted tuple without indexing or transformation. A caller expecting a keyed map should not receive a positional list that discards names. The loop choice propagates beyond the resource block.

The same rule applies to modules. `module "service"` with `for_each` becomes a map of module instances, so a child output is read as `module.service["api"].endpoint`. A counted module becomes an indexed collection. Instance-expansion semantics are shared across resource and module blocks.

Because references carry dependencies, downstream transforms do not require manual sequencing. A map of instance IDs derived from `aws_instance.server` is unknown in value until provider operations complete, but Terraform already knows which keyed instances produce it and which consumers depend on them.

## When Should You Use a `dynamic` Block?
<!-- section-summary: dynamic repeats nested provider-schema blocks inside one resource; it does not create separate resource instances or meta-arguments. -->

`dynamic` solves a different repetition problem. Some provider resources accept repeated nested blocks. A security group can generate several `ingress` blocks from a set of ports:

```hcl
variable "allowed_ports" {
  type    = set(number)
  default = [80, 443, 8080]
}

resource "aws_security_group" "app" {
  name   = "app-sg"
  vpc_id = aws_vpc.main.id

  dynamic "ingress" {
    for_each = var.allowed_ports

    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["10.0.0.0/16"]
    }
  }
}
```

![Dynamic Block Expansion](/content-assets/articles/article-iac-terraform-advanced-loops/dynamic-block-expansion.png)

The label must match a nested block type in the provider schema. Terraform emits one nested `ingress` block per port inside the single `aws_security_group.app` resource. It does not create three security-group resource addresses.

Inside `content`, the iterator is named after the dynamic label by default, so `ingress.value` is the current port. More complex dynamic blocks can use an explicit iterator, but the same principle applies: data generates provider-defined child configuration within one parent instance.

Use resource-level `for_each` when each repeated object deserves its own state identity. Use `dynamic` only when the provider model requires repeated inline blocks and literal blocks would be impractical. It cannot generate top-level resources, provider blocks, lifecycle blocks, or other meta-argument structures.

Because nested blocks share the parent's address, changing one generated block appears as a change to the parent resource. Separate rule resources may be clearer when each rule needs its own lifecycle and review identity. The provider schema and desired ownership boundary should drive that choice.

Literal nested blocks remain clearer for a small fixed set. `dynamic` is useful when data genuinely drives repeated nested configuration, but excessive use hides the provider schema behind another layer of transformation.

For two fixed rules, writing two literal `rule` or `ingress` blocks shows the provider shape directly. Reach for `dynamic` when callers provide a variable-length collection or a reusable module genuinely needs to translate input data into repeated nested blocks. Least-powerful does not mean least capable; it means the simplest construct that still represents the source data.

Terraform must process meta-arguments such as `lifecycle` before normal dynamic expansion, so a `dynamic "lifecycle"` pattern is not available. This limitation follows from evaluation phases: Terraform needs management rules in order to understand the resource before it can evaluate nested provider configuration.

## How Do You Choose the Smallest Safe Loop?
<!-- section-summary: The best loop matches durable identity, keeps graph shape known, and makes plan addresses understandable without adding unnecessary abstraction. -->

Use this decision model:

```text
N interchangeable copies → count
named instances or per-item settings → for_each
repeated nested blocks inside one resource → dynamic
two or three genuinely different resources → explicit blocks may be clearest
```

A fuller decision tree separates the layers:

```text
Do you need repetition?
├── no → write one clear block
└── yes
    ├── multiple resource or module instances?
    │   ├── positional/interchangeable → count
    │   └── named/different settings → for_each
    └── one resource instance?
        ├── transform a collection value → for expression
        └── repeat provider nested blocks → dynamic
```

The `for` expression belongs in the table because it is often confused with `for_each`. It transforms a collection into another value; it does not create managed instances. A `dynamic` block consumes a collection to generate nested configuration; it does not create top-level identities. `count` and `for_each` are the resource and module expansion tools.

Identity is the central test. `aws_instance.worker[2]` says position. `aws_instance.server["metrics"]` says a named role. Choose the address that will still describe the same object after inputs are inserted, removed, or reordered.

Do not abstract repetition only because syntax allows it. A complex transformation can be harder to review than several distinct resources. Loops are valuable when they reveal a real collection model and centralize a shared implementation.

Start explicitly when the shape is not understood. Repetition becomes a loop after you can identify the invariant implementation, the per-instance data, and the durable identity. Premature abstraction can hide meaningful differences behind flags and conditional lookups.

Inspect addresses in the plan, not only attributes. A change that should remove one named server should remove one matching key. Unexpected replacements after a list edit reveal positional identity. A migration from `count` to `for_each` changes addresses and should use explicit `moved` blocks when existing objects must survive.

For the three-server example, the state-preserving mapping is explicit:

```hcl
moved {
  from = aws_instance.server[0]
  to   = aws_instance.server["api"]
}

moved {
  from = aws_instance.server[1]
  to   = aws_instance.server["worker"]
}

moved {
  from = aws_instance.server[2]
  to   = aws_instance.server["metrics"]
}
```

The next plan should show address moves rather than destroying indexed instances and creating keyed replacements. Treat this as an identity migration, not a formatting refactor.

Also inspect outputs and downstream instances. A loop can preserve identity internally but then lose it by returning only an ordered list. Prefer keyed maps when consumers need to maintain the same business identity across module boundaries.

![Loops Summary](/content-assets/articles/article-iac-terraform-advanced-loops/loops-summary.png)

The deepest model is declarative expansion. `count` and `for_each` turn one configuration block into independently managed instances. Their indexes or keys become state identity. `dynamic` instead expands nested configuration inside one resource. All three reduce repetition, but only a loop whose identity matches the domain remains safe as the collection evolves.

A complete named-service model makes the choice concrete:

```hcl
variable "services" {
  type = map(object({
    instance_type = string
  }))

  default = {
    api = {
      instance_type = "m7i.large"
    }
    worker = {
      instance_type = "c7i.large"
    }
    metrics = {
      instance_type = "t3.medium"
    }
  }
}

resource "aws_instance" "service" {
  for_each = var.services

  ami           = var.ami
  instance_type = each.value.instance_type

  tags = {
    Name = each.key
  }
}
```

Terraform records `aws_instance.service["api"]`, `aws_instance.service["worker"]`, and `aws_instance.service["metrics"]`. Deleting the worker key destroys only the worker binding. Changing the API instance type changes the object still known as API.

Compare a homogeneous helper fleet:

```hcl
resource "aws_instance" "runner" {
  count = var.runner_count

  ami           = var.runner_ami
  instance_type = "c7i.large"
}
```

Here `runner[0]`, `runner[1]`, and later indexes honestly represent a pool whose members are interchangeable. Both loops are correct because each matches its domain identity.

The mechanisms can coexist. `for_each` can create named service resources, and a `dynamic` block inside each one can emit repeated nested configuration required by its provider schema. One layer chooses persistent resource identities; the other generates child blocks within each identity.

Review the whole expansion as a state contract. Inputs define number or keys. The meta-argument creates addresses. References and outputs carry the resulting collection shape. State preserves those identities between runs. Provider objects remain attached to them until a planned change updates, moves, or removes the corresponding address.

Before adopting a loop, write down the expected addresses. Then simulate adding an item, removing a middle item, renaming a key, and changing only an object's settings. The correct model should preserve every identity that the domain considers unchanged. This small exercise often reveals whether the design wants a number, a key, or explicit blocks.

Plans should be read as identity evidence. Attributes explain how an instance changes; addresses explain which instance Terraform believes it is changing. A short loop whose keys are unstable can be riskier than repeated code with clear addresses, while a keyed map can make a large collection safer and easier to review.

Finally, keep the source collection itself understandable. A clever one-line chain of conversions may technically produce the right map but hide duplicates, key choice, and filtering. Named locals can expose intermediate domain values before `for_each` expands them. The goal is a faithful model of persistent objects, not the shortest possible HCL.

That model also guides imports and state inspection. An imported keyed instance needs its full address, including quoted key. A counted instance needs its numeric index. Shell quoting matters for bracketed addresses, and state commands should confirm the exact instances Terraform already owns before any loop refactor changes their shape.

When a collection is exposed from a reusable module, document whether ordering, uniqueness, and keys are contractual. A list of IDs communicates sequence; a set communicates uniqueness without order; a map communicates named identity. The type is not just convenient transport—it tells downstream code which relationships are stable enough to depend on.

The final rule is simple: Terraform repetition declares a set of long-lived identities. Choose `count` when integer positions are those identities, `for_each` when durable keys are those identities, a `for` expression when only values need transforming, and `dynamic` when one provider resource needs repeated nested blocks.

If that identity cannot be explained in plain language, stop before applying. Rework the input data until the plan names the objects the same way operators, owners, and future maintainers will identify them.

Loop identity is state identity. `count` produces numeric addresses whose meaning can shift when a list is reordered or an earlier item is removed; `for_each` produces key-based addresses that remain stable when keys represent durable identities. Choose the collection shape before creating resources, keep keys non-sensitive and known during planning, and inspect address changes whenever refactoring. A loop reduces repeated syntax, but it should not collapse objects with different lifecycle or policy into one abstraction merely because their blocks look similar.

State makes loop identity observable. After apply, `terraform state list` shows indexed addresses from `count` and keyed addresses from `for_each`. Compare those addresses before and after a collection edit: a changed list index can shift several identities, while a removed map key normally removes only the instance owned by that key.

## Check Your Answers

:::expand[What Does Looping Mean in Terraform?]{kind="recap"}
Terraform expands one declaration into managed instances with distinct addresses. It does not execute a creation instruction repeatedly like an imperative loop.
:::

:::expand[When Does `count` Fit the Resource Identity?]{kind="recap"}
Use `count` when the domain is a known number of interchangeable copies. Each instance receives a zero-based positional address.
:::

:::expand[Why Can Positional Identity Cause Surprising Changes?]{kind="recap"}
Removing a middle list item shifts later meanings across fixed indexes. Terraform follows addresses, so updates or replacements may not match human names.
:::

:::expand[How Does `for_each` Create Named Instances?]{kind="recap"}
`for_each` creates one instance for each map key or set string. Stable keys make names part of state identity and isolate removals.
:::

:::expand[How Do Sets, Maps, and Object Lists Become `for_each` Inputs?]{kind="recap"}
Sets fit string identities, maps pair stable keys with settings, and a `for` expression can transform object lists into keyed maps.
:::

:::expand[How Do Repeated Resources Flow Through the Graph?]{kind="recap"}
Counted resources become collections and keyed resources become maps. Preserve their shape in outputs, chain matching keys, and keep instance shape known before apply.
:::

:::expand[When Should You Use a `dynamic` Block?]{kind="recap"}
Use `dynamic` for data-driven nested blocks supported by one resource schema. It does not create resources or generate Terraform meta-argument blocks.
:::

:::expand[How Do You Choose the Smallest Safe Loop?]{kind="recap"}
Choose the construct whose address matches durable identity, inspect plan and state addresses, and keep explicit blocks when abstraction would hide real differences.
:::

### References

- [`count` meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/count)
- [`for_each` meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [`dynamic` blocks](https://developer.hashicorp.com/terraform/language/expressions/dynamic-blocks)
- [`for` expressions](https://developer.hashicorp.com/terraform/language/expressions/for)
- [Splat expressions](https://developer.hashicorp.com/terraform/language/expressions/splat)
- [Refactoring with `moved` blocks](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
