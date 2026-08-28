---
title: "Resource Dependencies"
description: "Understand how Terraform discovers resource order from references, where depends_on is useful, and how dependency choices appear in plan output."
overview: "Terraform follows references between resources and outputs to decide what runs first. This article uses a small application stack to show implicit dependencies, explicit dependencies, cycles, and plan output."
tags: ["terraform", "dependencies", "graph", "depends_on"]
order: 8
id: article-iac-terraform-config-dependencies
aliases:
  - infrastructure-as-code/terraform/configuration/dependencies.md
---

## Table of Contents

1. [Why Does Terraform Need a Dependency Graph?](#why-does-terraform-need-a-dependency-graph)
2. [How Do References Create Implicit Dependencies?](#how-do-references-create-implicit-dependencies)
3. [How Do Dependencies Cross Values and Module Boundaries?](#how-do-dependencies-cross-values-and-module-boundaries)
4. [How Does the Graph Control Planning and Operations?](#how-does-the-graph-control-planning-and-operations)
5. [When Should You Use dependson?](#when-should-you-use-dependson)
6. [How Do You Find and Break Dependency Cycles?](#how-do-you-find-and-break-dependency-cycles)
7. [What Does a Dependency Not Mean?](#what-does-a-dependency-not-mean)
8. [How Do You Build and Debug a Complete Dependency Graph?](#how-do-you-build-and-debug-a-complete-dependency-graph)
9. [Check Your Answers](#check-your-answers)

A VPC, subnet, and instance have real prerequisites:

```text
VPC
 │
 ▼
Subnet
 │
 ▼
Instance
```

The subnet needs a VPC identity, and the instance needs a subnet identity. An imperative script might say “create the VPC, read its ID, create the subnet, read its ID, then create the instance.” Terraform describes the relationships:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id
}
```

Terraform reads the expressions and derives:

```text
aws_vpc.main
      │
      ▼
aws_subnet.app
      │
      ▼
aws_instance.web
```

The `.tf` file is not an ordered script. Placing the instance block above the VPC does not instruct Terraform to create the instance first. Terraform interprets objects, expressions, and directed relationships; file order is mainly for human organization.

![References create directed edges between Terraform objects](/content-assets/articles/article-iac-terraform-config-dependencies/dependency-edge-map.png)

Keep these questions in view as you work through the lesson:

1. **Why Does Terraform Need a Dependency Graph?**
2. **How Do References Create Implicit Dependencies?**
3. **How Do Dependencies Cross Values and Module Boundaries?**
4. **How Does the Graph Control Planning and Operations?**
5. **When Should You Use `depends_on`?**
6. **How Do You Find and Break Dependency Cycles?**
7. **What Does a Dependency Not Mean?**
8. **How Do You Build and Debug a Complete Dependency Graph?**

## Why Does Terraform Need a Dependency Graph?

A directed edge from VPC to subnet means the VPC is an upstream prerequisite and the subnet is downstream. It does not merely say the objects are related. It says Terraform cannot correctly process the subnet until the upstream state or information required by that relationship is available.

The graph lets Terraform answer several questions at once: which operation must wait, which work is independent, which values are known in the plan, how creation and replacement should be ordered, and which dependency order must normally reverse during destruction.

To see why file order is insufficient, place the instance first:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

The visual order is server, VPC, subnet, but the graph remains VPC, subnet, server. Terraform can move blocks among files in the same module without changing those edges because references, not line numbers, carry the prerequisites.

A directed edge also has a precise reading. In `VPC -> Subnet`, the VPC is upstream and the subnet is downstream. The arrow does not mean both resources always change together, nor that the VPC must wait for the subnet. It means the subnet cannot be handled correctly until its dependency on the VPC permits it. Direction matters for traversing creation and destruction.

## How Do References Create Implicit Dependencies?

This single argument expresses value flow:

```hcl
vpc_id = aws_vpc.main.id
```

For a new VPC, the provider cannot return its remote ID before creation. The subnet consumes that future ID. Terraform therefore infers an **implicit dependency**:

```text
aws_vpc.main produces .id
             │
             ▼
aws_subnet.app consumes it as vpc_id
```

The reference carries two kinds of information:

1. Which exact value the subnet needs.
2. Which upstream object must become sufficiently complete first.

This is why Terraform dependency graphs are also value graphs. A provider operation produces information, another expression consumes it, and the required ordering follows naturally.

An explicit dependency would be redundant here:

```hcl
resource "aws_subnet" "app" {
  depends_on = [aws_vpc.main]
  vpc_id     = aws_vpc.main.id
}
```

The simpler reference already explains *why* the edge exists. `depends_on` says only “wait for this object”; the attribute reference says “I need this object's ID.” Prefer ordinary references whenever real data flow can express the relationship.

Independent resources have no edge. If an S3 bucket and an EC2 instance neither consume values nor share a behavioral prerequisite, Terraform may work on them concurrently. Adding arbitrary ordering reduces parallelism and creates coupling without describing architecture. Dependency edges should represent causal requirements, not a preference for seeing one item appear first in logs.

Follow the information behind the VPC chain in detail:

```text
provider creates VPC
         │
         ▼
provider returns VPC ID
         │
         ▼
subnet argument receives VPC ID
         │
         ▼
provider creates subnet
         │
         ▼
provider returns subnet ID
         │
         ▼
instance argument receives subnet ID
```

This is why implicit dependencies are usually more informative than manual ordering. Terraform knows not merely that the subnet must wait, but which attribute remains unknown and where it will be consumed. The graph can preserve the type and location of an unknown value while deferring only the operation that truly needs it.

Adding a redundant `depends_on` does not strengthen this relationship. The attribute reference already connects the correct producer and consumer. Extra edges can obscure whether the dependency is data-driven or behavioral and may cause Terraform to retain less precise knowledge during planning.

## How Do Dependencies Cross Values and Module Boundaries?

A local does not erase its upstream dependency:

```hcl
locals {
  application_vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "app" {
  vpc_id = local.application_vpc_id
}
```

Terraform follows the complete chain:

```text
aws_vpc.main.id
       │
       ▼
local.application_vpc_id
       │
       ▼
aws_subnet.app.vpc_id
```

Locals are expression nodes, not execution phases. A local depending on a resource attribute stays unknown until that resource produces the attribute; a resource consuming a known local can proceed when all other prerequisites allow it.

Dependencies also cross a module interface. A network child can publish:

```hcl
output "vpc_id" {
  value = aws_vpc.main.id
}
```

The parent connects two modules:

```hcl
module "network" {
  source = "./modules/network"
}

module "application" {
  source = "./modules/application"

  vpc_id = module.network.vpc_id
}
```

The value flows from the child VPC, through the network output and parent expression, into the application input and resources. Terraform keeps the dependency across that organizational boundary. A broad `depends_on = [module.network]` is unnecessary when the specific output already expresses what the application needs.

Data sources participate too:

```hcl
resource "aws_instance" "web" {
  # ...
}

data "some_lookup" "details" {
  instance_id = aws_instance.web.id
}
```

If the ID is unknown during planning, the read waits for apply and its returned attributes remain unknown. Outputs behave in the other direction: `output.public_ip` depends on the instance attribute it exposes, and a parent resource consuming that child output becomes downstream as well.

There is no fixed phase order such as variables, then locals, then data, then resources, then outputs. Any of these value nodes can depend on another where the language permits. References, rather than construct categories or file positions, determine the graph.

Indirect unknowns make this dependency chain important during debugging. A module input may look like an ordinary string, but its parent expression can come from a resource ID that does not exist yet. Inside the child, a local can transform that input and a data source can use the result as query criteria. The data-source read then waits for apply, and any child output derived from it stays unknown. The dependency crosses every boundary even though the originating resource name may appear only in the parent.

```text
parent resource attribute
          │
          ▼
child module input
          │
          ▼
child local
          │
          ▼
child data source
          │
          ▼
child output
          │
          ▼
parent consumer
```

Terraform follows the expression references throughout that chain. Module encapsulation hides implementation details from human callers, but it does not sever graph semantics.

## How Does the Graph Control Planning and Operations?

Dependencies identify both required waiting and safe parallelism. With two branches:

```text
             VPC
            /   \
           ▼     ▼
      Subnet A  Subnet B
          │        │
          ▼        ▼
       Server A  Server B
```

the VPC must finish before either subnet, but the subnets can proceed together. Each server waits only for its own subnet. Terraform finds a partial order, not one giant numbered sequence.

![Terraform schedules independent branches in parallel while respecting prerequisites](/content-assets/articles/article-iac-terraform-config-dependencies/dependency-graph.png)

Dependencies also explain plan-time unknowns. Before a new VPC exists:

```text
aws_vpc.main.id = (known after apply)
```

so:

```text
aws_subnet.app.vpc_id = (known after apply)
```

and the subnet ID may keep the instance's `subnet_id` unknown. Terraform is not confused. It knows where every value will come from and which operations must precede its consumers; the provider simply has not generated the concrete IDs yet.

Creation usually follows dependency direction:

```text
VPC -> subnet -> instance
```

Destruction normally follows the reverse because Terraform cannot remove a VPC while downstream subnet and instance relationships still exist:

```text
instance -> subnet -> VPC
```

Replacement can be more complex. Terraform may model destruction of an old object, creation of a replacement, and updates or replacements of consumers as distinct graph operations. A lifecycle rule such as `create_before_destroy` changes how those nodes are scheduled. The invariant is that Terraform uses the real relationships to construct a safe operation graph rather than following source order.

A dependency does not require every downstream operation to be serial. Only paths connected by edges must wait. The graph maximizes independent work within the configured concurrency limits while retaining valid creation, refresh, replacement, and destroy prerequisites.

The parallel branches show why artificial dependencies have a cost. If Subnet B is made to depend on Subnet A without a real requirement, Terraform loses the ability to create them together. Server B is also delayed even though its actual prerequisite may already be ready. One unnecessary edge can serialize an entire downstream branch.

Plan-time unknowns reveal the same precision. Terraform may know both resources must be created, know their arguments' types, and know the exact edge between them while leaving one value as `(known after apply)`. When the provider returns that value, Terraform substitutes it into the waiting operation. Unknown does not mean “run in an arbitrary order”; it often means the graph is understood but remote information has not been produced.

Destruction relies on truthful edges because many APIs reject removing a container while dependents remain. If an arbitrary dependency says a bucket is upstream of an unrelated instance, Terraform may also delay bucket destruction for no architectural reason. Accurate graphs benefit the whole lifecycle, not only the first apply.

Replacement can split one logical resource change into multiple operation nodes. The old object may need to remain until a new object and its consumers are ready, or it may need removal before recreation. Lifecycle configuration and provider behavior interact with the dependency graph to determine that ordering. This is why dependencies should model prerequisites rather than assumptions about a single simple create sequence.

## When Should You Use `depends_on`?

Use `depends_on` for a real behavioral prerequisite that no value reference can express. Imagine an application operation requires an IAM policy attachment to be active, but the application needs no ID, name, or ARN from that attachment:

```hcl
resource "aws_iam_role_policy_attachment" "permissions" {
  # ...
}

resource "some_application" "app" {
  # ...

  depends_on = [
    aws_iam_role_policy_attachment.permissions
  ]
}
```

Terraform sees no ordinary data edge, while the external system has this prerequisite:

```text
permission attachment completes
             │
             ▼
application operation becomes valid
```

The explicit declaration adds that hidden relationship to the graph.

![Implicit references carry values while explicit dependencies represent hidden behavior](/content-assets/articles/article-iac-terraform-config-dependencies/implicit-explicit-dependencies.png)

`depends_on` is not a sleep instruction. It does not mean “wait 30 seconds”; it makes one graph node downstream of another and waits for the relevant Terraform operation to finish. If a remote service reports success before an eventual-consistency delay ends, dependency ordering alone is not a universal timing cure.

Prefer a real reference when one exists:

```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.app.id
}
```

is more precise than passing an unrelated `var.subnet_id` while declaring a broad dependency on `aws_subnet.app`. The reference identifies the exact information required and helps Terraform determine which downstream values can be known.

Broad dependencies can make planning conservative. This module-level edge:

```hcl
module "application" {
  source = "./application"

  depends_on = [module.network]
}
```

says that the application module depends on the whole network module. If the real relationship is one output, express:

```hcl
module "application" {
  source = "./application"

  subnet_ids = module.network.private_subnet_ids
}
```

Use the smallest boundary that tells the truth. Start with a specific attribute reference, then a specific resource-level hidden dependency, and use a broad module dependency only when the entire boundary is genuinely prerequisite.

A useful contrast is:

```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.app.id
}
```

versus:

```hcl
resource "aws_instance" "web" {
  subnet_id = var.subnet_id

  depends_on = [
    aws_subnet.app
  ]
}
```

The first says the consumer needs the exact ID produced by the subnet. The second says only that some operation on the subnet should precede the instance while obtaining the actual ID from elsewhere. Unless that split ownership is intentional, it creates a weaker and potentially misleading model.

At module scale, a broad explicit edge can make Terraform treat downstream values as unknown because any relevant upstream change may be considered a prerequisite. Passing only `module.network.private_subnet_ids` communicates the smaller set of information the application really needs. “Larger boundaries come later” is a useful rule: widen an edge only after proving that a narrow value or resource dependency cannot represent the external behavior.

Document the hidden reason in surrounding architecture or naming, since the HCL reference itself cannot show it. “Policy must be attached before the application provider starts provisioning” is a defensible prerequisite. “I like IAM to appear first” is not.

## How Do You Find and Break Dependency Cycles?

A valid dependency graph must have a starting point. This configuration has none:

```hcl
resource "example_a" "a" {
  other_id = example_b.b.id
}

resource "example_b" "b" {
  other_id = example_a.a.id
}
```

Terraform sees A needing B's ID and B needing A's ID:

```text
A ─────► B
▲        │
└────────┘
```

Choosing one arbitrarily would not satisfy the declaration. Adding more `depends_on` edges cannot repair the impossible structure; the architecture must change.

A common solution separates object creation from the relationship connecting the objects:

```text
create A        create B
    │              │
    └──────┬───────┘
           ▼
       association
```

When two security groups need rules that refer to each other's generated IDs, create the groups independently and model the cross-group rules as separate resources where the provider supports that design. The parent identities then feed the association, rather than each parent requiring the other's ID during its own creation.

Cycles can be indirect. A resource may feed a local, the local a module input, a child output another parent resource, and that resource loop back to the first. Debug by tracing each required value to its origin until the path repeats.

`terraform graph` emits the dependency graph in GraphViz DOT form and provides options useful for diagnosing graph and cycle errors. It is not necessary for ordinary authoring, but it can reveal relationships hidden behind locals or modules. The goal is not to force one node first; it is to identify which relationship should be removed, delayed, or modeled as a separate association.

Security-group relationships illustrate the redesign. A naive configuration may embed a rule in the frontend group that needs the backend group ID and a rule in the backend group that needs the frontend group ID. If both parent resources require those generated IDs during creation, the graph closes into a loop. Separate rule resources let both groups be created first and then attach rules using both IDs.

```text
frontend group ─────┐
                    ├──► cross-group rules
backend group ──────┘
```

The same “create things first, connect them second” pattern applies whenever an API exposes an association as a separate object. It changes the architecture from mutual construction requirements to two independent producers feeding one downstream relationship.

When the provider does not expose a separable relationship, reconsider whether both references are actually required at creation time or whether one direction can be configured after an initial object exists. The fix must create a resolvable graph; adding order to an impossible mutual prerequisite merely restates the problem.

## What Does a Dependency Not Mean?

Dependencies and data flow overlap, but they are not identical. Most implicit edges arise because B consumes `A.id`. Some edges represent behavior without transferring a useful value, such as a permission becoming active before an application operation. That is why both references and `depends_on` exist.

A dependency also does not mean every upstream change must replace the downstream object. Suppose an instance consumes a subnet ID:

```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.app.id
}
```

Changing an unrelated subnet tag does not inherently replace the instance if the consumed ID stays the same. The dependency tells Terraform to respect the relationship. Provider schemas, lifecycle rules, and the particular attribute changes determine whether the consumer needs no action, update, or replacement.

`replace_triggered_by` is a stronger and different lifecycle rule:

```hcl
resource "some_service" "consumer" {
  lifecycle {
    replace_triggered_by = [
      some_resource.example
    ]
  }
}
```

This requests replacement when the referenced object or condition changes. `depends_on` establishes prerequisite ordering; it does not by itself say “replace me whenever that changes.” Keep ordering, value propagation, and replacement triggers conceptually separate.

Nor does a dependency mean all downstream branches wait for one another. In `VPC -> Subnet A -> App A` and `VPC -> Subnet B -> App B`, there is no App A to App B edge. Terraform can operate each branch independently as soon as its actual prerequisites are ready.

The correct design question is not “How do I make this resource step seven?” Ask what must be true before the object can exist or operate correctly. Express the truth through a resource attribute, module output, or data relationship. Use `depends_on` only when the prerequisite is real but no value can represent it.

Another non-equivalence is dependency versus readiness. Terraform normally considers an upstream operation complete when the provider reports completion. If an external service then takes time to converge, a downstream API call may still fail even though the graph edge was honored. Model a provider-supported readiness condition or appropriate resource where available; do not assume `depends_on` adds arbitrary waiting beyond Terraform's operation boundary.

Similarly, dependency is not ownership. A data source may depend on a managed resource ID, but the read still does not own the external object it queries. A parent resource may depend on a child output, but the output remains an interface value rather than a remote object. Edges connect different node kinds without changing their lifecycle roles.

Finally, a plan showing an upstream update does not imply all downstream nodes receive an operation. Terraform evaluates whether the consumed values or behavioral conditions require changes. This selectivity is a benefit of precise references: an unrelated tag change can remain local to the upstream resource, while an ID-changing replacement can propagate to actual consumers.

## How Do You Build and Debug a Complete Dependency Graph?

Consider a VPC and subnet branch plus an IAM permission branch. The application needs a subnet ID and also requires the policy attachment behavior to complete:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_iam_role" "app" {
  name = "application"
}

resource "aws_iam_role_policy_attachment" "app" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/SomePolicy"
}

resource "aws_instance" "app" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id

  depends_on = [
    aws_iam_role_policy_attachment.app
  ]
}
```

Trace each edge. `aws_vpc.main.id` makes the subnet depend on the VPC. `aws_subnet.app.id` makes the instance depend on the subnet. `aws_iam_role.app.name` makes the attachment depend on the role. The explicit `depends_on` connects attachment behavior to the instance.

The graph is:

```text
          VPC                 IAM Role
           │                     │
           ▼                     ▼
         Subnet             Policy Attachment
           │                     │
           └─────────┬───────────┘
                     ▼
              Application
```

Terraform can start VPC and IAM role work independently. The subnet waits for its VPC; the attachment waits for its role. The application waits for both branches. Before apply, unknown IDs flow down the network branch, while the permission branch has its own pending results.

During apply, a possible schedule is:

```text
              start
        ┌───────┴───────┐
        ▼               ▼
    create VPC      create IAM role
        │               │
        ▼               ▼
   create subnet    attach policy
        │               │
        └───────┬───────┘
                ▼
       create application
```

During destruction, the useful order reverses: remove the application first, then its subnet and permission attachment, then the VPC and IAM role. The same truthful edges support both directions.

When something appears to happen too early, use a disciplined diagnostic sequence:

1. State the exact prerequisite: “B requires A because …”.
2. Check whether B consumes an attribute from A; if so, reference it directly.
3. If no value flows, verify that the behavioral prerequisite is real and use `depends_on` at the narrowest boundary.
4. Trace unknown values through locals, data sources, modules, and outputs.
5. Look for a cycle if every node seems to require another node first.
6. Check whether the concern is actually replacement behavior rather than ordering.

Start by filling in the reason with a concrete noun and operation. “The application requires the role policy because its creation calls an API protected by that permission” is testable. “The application depends on IAM” is too broad. A precise statement usually reveals either an attribute the configuration should reference or a specific resource whose completion represents the hidden prerequisite.

If a value flows, follow it through every intermediate expression. A local may rename the value; a child module may accept it as an input and publish another output; a data source may delay its read because that input is unknown. None of those layers removes the originating edge. Writing the chain on paper often explains a plan-time unknown without needing any explicit dependency.

If no value flows, confirm that Terraform's provider operation really needs the upstream behavior complete. Then place `depends_on` on the narrow dependent object rather than an entire enclosing module when possible. Review the next plan for an increase in `(known after apply)` values; that can indicate the new edge is broader than the true prerequisite.

For cycles, write the loop as arrows and label what each arrow carries. If A needs B's generated ID and B needs A's generated ID, look for an association resource. If one arrow represents convenience rather than a creation requirement, remove or defer it. The graph must gain at least one valid starting node.

For replacement surprises, inspect the actual consumed attribute. A dependency edge alone does not request replacement. Determine whether the upstream change alters that attribute, whether the provider marks the downstream argument as replacement-requiring, or whether a lifecycle rule such as `replace_triggered_by` deliberately connects the changes.

`terraform graph` can supplement this reasoning by making indirect edges visible, but a rendered graph does not explain business intent. Compare its arrows with the stated prerequisites and remove relationships that exist only because configuration was wired broadly. The best graph is not the most connected graph; it is the smallest graph that accurately represents every real prerequisite.

This procedure preserves Terraform's advantages. Precise references let the planner calculate more values early. Narrow behavioral edges prevent invalid operations. Independent branches remain parallel. Reverse destruction follows real containment and usage. And a cycle error becomes an architectural clue rather than a request for arbitrary sequencing.

The same review should include removals. Deleting a resource block can cause Terraform to traverse dependents before prerequisites in reverse, and removing an edge can change which destroys are considered independent. A graph that was safe for creation but contains artificial or missing relationships can reveal its problems most sharply during replacement or teardown.

Think in prerequisites instead of sequence numbers throughout the lifecycle. Ask which value or behavior must exist, which object supplies it, and how narrowly that fact can be expressed. Terraform then derives the schedule for plan, apply, refresh, replacement, and destroy. This keeps configuration declarative: the author states causal truth, while Terraform chooses a valid order and available parallel work.

Accurate edges make that derived schedule both safer and more efficient, while preserving the reasons behind every wait.

They also make unknown values, replacements, and destruction paths explainable during review instead of surprising during apply.

That clarity is the graph's practical value.

It lets reviewers distinguish required causality from accidental serialization before either affects real infrastructure.

Precise causality remains the governing principle.

Ordering follows from it.

Parallelism does too.

![Dependencies describe causal prerequisites from values and hidden behavior](/content-assets/articles/article-iac-terraform-config-dependencies/dependencies-summary.png)

The deepest model is causal, not sequential. Terraform edges say one object needs information or behavior from another. Ordering, parallelism, plan-time unknowns, reverse destruction, and cycle detection are consequences of that graph.

The complete example also shows why two dependency forms can coexist without duplication. The network branch carries data: the instance needs `aws_subnet.app.id`. The IAM branch carries behavior: the instance provisioning requires the attachment to be complete but consumes none of its attributes. Treating both as explicit ordering would lose information from the first branch; pretending both must transfer values would invent an artificial argument for the second.

During plan review, follow each `(known after apply)` value upstream. The instance's unknown subnet ID leads to the subnet, whose unknown VPC ID leads to the VPC creation. This chain is expected and resolvable. If an unknown appears because a whole module is broadly dependent on another module, ask whether a narrower output reference could let Terraform know more.

During failure diagnosis, distinguish three cases. A missing edge allows a downstream operation too early. An overly broad edge causes unnecessary waiting or unknowns. A cycle leaves no valid starting point. The remedy differs: add a truthful narrow prerequisite, remove or narrow an artificial relationship, or restructure object creation and association.

The graph is therefore both an execution model and a design feedback tool. Clean value flow produces precise edges, exposes real ownership, and permits safe parallelism. Hidden external prerequisites deserve explicit edges. Circular or arbitrary relationships signal that the configuration does not yet represent the infrastructure causally.

The graph is derived primarily from references, so passing one resource's attribute into another usually supplies both data and ordering. Add `depends_on` only for a real relationship Terraform cannot infer, such as behavior established without a value reference. Overusing explicit edges serializes unrelated work and hides the data flow reviewers need to understand. When an ordering problem appears, first ask whether the dependent configuration should reference the producer's output directly; that often fixes both the graph and the module interface.

## Check Your Answers

:::expand[Why Does Terraform Need a Dependency Graph?]{kind="recap"}
Terraform configuration describes objects and relationships, not numbered steps. The dependency graph identifies prerequisites, independent work, known values, and safe operation ordering.
:::

:::expand[How Do References Create Implicit Dependencies?]{kind="recap"}
An attribute reference carries a value and shows which upstream object must produce it. Terraform infers a precise implicit edge from that data flow.
:::

:::expand[How Do Dependencies Cross Values and Module Boundaries?]{kind="recap"}
Locals, data sources, module inputs and outputs, and root outputs preserve reference chains. Constructs are graph nodes, not fixed execution phases.
:::

:::expand[How Does the Graph Control Planning and Operations?]{kind="recap"}
The graph permits independent branches to run in parallel, propagates unknown values during planning, orders creation, and normally reverses prerequisites during destruction.
:::

:::expand[When Should You Use `depends_on`?]{kind="recap"}
Use `depends_on` for a genuine behavioral prerequisite with no value reference. Prefer the smallest truthful edge and avoid broad dependencies that make planning conservative.
:::

:::expand[How Do You Find and Break Dependency Cycles?]{kind="recap"}
A cycle has no valid starting point. Trace references to find the loop, then separate object creation from relationship attachment or otherwise redesign the graph.
:::

:::expand[What Does a Dependency Not Mean?]{kind="recap"}
A dependency is not a sleep, universal serialization, or automatic replacement rule. Provider semantics determine change effects, while `replace_triggered_by` explicitly controls replacement.
:::

:::expand[How Do You Build and Debug a Complete Dependency Graph?]{kind="recap"}
State the real prerequisite, prefer attribute references, add narrow hidden edges only when needed, trace unknowns and cycles, and distinguish ordering from lifecycle triggers.
:::

### References

- [Terraform dependency graph](https://developer.hashicorp.com/terraform/internals/graph)
- [Configure a resource](https://developer.hashicorp.com/terraform/language/resources/configure)
- [`depends_on` meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on)
- [Query data from external sources](https://developer.hashicorp.com/terraform/language/data-sources)
- [`terraform graph` command](https://developer.hashicorp.com/terraform/cli/commands/graph)
