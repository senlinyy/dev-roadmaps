---
title: "What Is Terraform?"
description: "Understand Terraform as a declarative reconciliation system that turns reviewed infrastructure intent into provider API changes."
overview: "Terraform compares declared infrastructure with the remote objects it manages, proposes a transition, executes approved changes through providers, and records resource identity in state. Learn why configuration, providers, resources, state, plan, apply, data sources, and modules all exist."
tags: ["terraform", "infrastructure-as-code", "providers", "state", "workflow"]
order: 2
id: article-iac-terraform-foundations-what-is-terraform
---

## Table of Contents

1. [What Problem Does Terraform Solve?](#what-problem-does-terraform-solve)
2. [How Do Configuration, Terraform Core, Providers, and Resources Work Together?](#how-do-configuration-terraform-core-providers-and-resources-work-together)
3. [How Do Resource References Form a Dependency Graph?](#how-do-resource-references-form-a-dependency-graph)
4. [Why Does Terraform Need State?](#why-does-terraform-need-state)
5. [How Do Init, Plan, and Apply Form a Reconciliation Loop?](#how-do-init-plan-and-apply-form-a-reconciliation-loop)
6. [What Happens When Desired Infrastructure Changes?](#what-happens-when-desired-infrastructure-changes)
7. [Where Are Terraform's Important Boundaries?](#where-are-terraforms-important-boundaries)
8. [How Does the Complete Terraform Model Fit Together?](#how-does-the-complete-terraform-model-fit-together)
9. [Check Your Answers](#check-your-answers)

Terraform is a **declarative infrastructure management system**. Declarative means that configuration describes the result you want rather than spelling out every API call needed to reach that result. Terraform reads that description, learns about the infrastructure it already manages, asks providers about remote objects, and works out a transition toward the declared result.

Start with one server. The desired world might be:

```text
Web server
├── region: eu-west-2
├── size: t3.small
└── environment: production
```

The actual cloud account currently contains no server. A one-time script could call a create API, but infrastructure stays alive after that first call. Tomorrow the desired size may become `t3.medium`. Next month the team may want three servers while only two exist. Later, a database may need to be removed. The durable problem is therefore larger than creation:

```text
What should exist?
What exists now?
Which managed object is which?
What is different?
Which operations can move one state toward the other?
```

Keep these questions in view as you work through the lesson:

1. **What Problem Does Terraform Solve?**
2. **How Do Configuration, Terraform Core, Providers, and Resources Work Together?**
3. **How Do Resource References Form a Dependency Graph?**
4. **Why Does Terraform Need State?**
5. **How Do Init, Plan, and Apply Form a Reconciliation Loop?**
6. **What Happens When Desired Infrastructure Changes?**
7. **Where Are Terraform's Important Boundaries?**
8. **How Does the Complete Terraform Model Fit Together?**

## What Problem Does Terraform Solve?
<!-- section-summary: Terraform repeatedly compares desired infrastructure with managed remote reality and calculates the operations needed to reconcile them. -->

Terraform is built around answering those questions repeatedly. A compact first-principles model uses three inputs:

```text
C = configuration, or declared intent
S = state, or Terraform's resource-identity record
R = remote reality reported through provider APIs
```

Terraform uses `C`, `S`, and refreshed information from `R` to calculate a **plan**. The plan describes the proposed difference: create an absent object, update a property, replace an object that cannot change in place, or destroy a managed object that is no longer desired. An approved **apply** executes that transition and records the result for the next run.

This is why the familiar `write → plan → apply` workflow is more than a list of commands. It separates three responsibilities: humans declare and review intent, Terraform calculates the operational meaning, and providers perform platform-specific API work.

The distinction between desired and actual reality also explains why a small configuration edit can have a large consequence. Changing one database engine value is a tiny text diff. The provider may determine that the remote transition requires replacement. Terraform's value is partly that it shows the infrastructure consequence before performing it.

![Terraform change loop showing configuration, state, provider reality, plan, review, apply, and the updated remote system](/content-assets/articles/article-iac-terraform-foundations-what-is-terraform/terraform-change-loop.png)

*Terraform turns declared intent, remembered identity, and observed reality into a reviewable transition rather than an immediate API call.*

## How Do Configuration, Terraform Core, Providers, and Resources Work Together?
<!-- section-summary: Configuration declares managed objects, Terraform Core reasons about the graph and lifecycle, and providers supply remote-system vocabulary and API behavior. -->

The loop begins with **Terraform configuration**: usually files ending in `.tf` and written in HashiCorp Configuration Language, or HCL. A resource block declares that one logical infrastructure object should exist with selected properties:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.small"
}
```

A procedural reading would be “create a server now.” The more accurate declarative reading is “the managed object addressed as `aws_instance.web` should exist with these arguments.” That declaration remains relevant throughout the object's lifecycle. Terraform may later use it to update, replace, or remove the remote object.

Configuration alone cannot create anything. **Terraform Core**, the main Terraform program, understands configuration structure, expressions, dependencies, state, change planning, and operation ordering. Core does not contain complete knowledge of every AWS, Azure, Google Cloud, Kubernetes, GitHub, Cloudflare, DNS, or SaaS API.

That platform-specific knowledge belongs to **providers**. A provider is a plugin that contributes resource types and data sources and knows how to authenticate, inspect remote objects, validate provider-specific arguments, call the relevant APIs, and interpret returned values. A configuration declares the provider implementation it requires:

```hcl
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

The `required_providers` block identifies where the provider plugin comes from. The `provider` block configures an instance of that provider, here selecting an AWS region. A resource such as `aws_instance.web` then uses a resource type implemented by that plugin.

Core and provider have different views of a change. If `instance_type` moves from `t3.small` to `t3.medium`, Core can see that the desired value changed. The AWS provider knows what those values mean, how EC2 reports the current instance, whether the property can change in place, which API operation is needed, and which attributes AWS will calculate afterward.

A **resource** is Terraform's logical unit for a managed remote object. In this block:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
```

`aws_vpc` is the provider-defined resource type and `main` is the configuration's local name. Together they form the resource address `aws_vpc.main`. AWS may assign the real VPC an identifier such as `vpc-07c31842`. Terraform therefore works with two identities:

```text
Terraform address       Provider identity
aws_vpc.main       →    vpc-07c31842
```

The Terraform address is stable inside the configuration and dependency graph. The provider identity is how the remote platform locates the actual object. Connecting those identities is one of the central jobs of state, which we will reach after examining the graph between resources.

![Terraform Core and provider boundary showing configuration and state on the Terraform side and platform-specific APIs on the provider side](/content-assets/articles/article-iac-terraform-foundations-what-is-terraform/provider-state-boundary.png)

*Terraform Core owns general planning and graph logic; providers translate that logic into the vocabulary and API operations of each remote system.*

## How Do Resource References Form a Dependency Graph?
<!-- section-summary: References connect resource attributes and tell Terraform which objects must be available before dependent operations can run. -->

Infrastructure objects rarely stand alone. A subnet belongs to a VPC, a server uses a subnet, and a load balancer forwards to application targets. Terraform expressions can connect those objects directly:

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
  instance_type = "t3.small"
  subnet_id     = aws_subnet.app.id
}
```

`aws_vpc.main.id` means “use the provider-reported ID of this managed VPC.” `aws_subnet.app.id` does the same for the subnet. These expressions pass values, but they also expose relationships to Terraform Core:

```text
aws_vpc.main
      ↓
aws_subnet.app
      ↓
aws_instance.web
```

Terraform can infer that the VPC must be available before the subnet can be created, and that the subnet must be available before the instance can use it. The full configuration becomes a directed dependency graph rather than a text file executed strictly from top to bottom.

That graph matters during every lifecycle action. Creation can proceed from dependencies toward consumers. Destruction generally proceeds in the safe reverse order. Independent branches may run concurrently. A value that the provider cannot know until apply remains unknown in the plan until its producer has been created.

This graph-oriented model is why most ordinary dependencies should be expressed through references. A manually written sequence says “run this after that” without necessarily explaining why. A reference says “this object's argument requires that object's result,” which gives Terraform both the data flow and the ordering reason.

The graph also explains why configuration is more than a bag of cloud objects. It is a model of infrastructure relationships. Terraform Core parses those relationships; each provider implements the resource-specific operations at the graph nodes.

## Why Does Terraform Need State?
<!-- section-summary: State preserves the binding between logical Terraform addresses and the particular remote objects Terraform manages. -->

After the first apply, AWS may report that `aws_instance.web` created `i-01abc987`. On the next run, Terraform must know that the same resource block refers to that particular instance rather than another EC2 instance in the account. It needs durable identity memory.

**Terraform state** records bindings such as:

```text
aws_vpc.main       → vpc-1234
aws_subnet.app     → subnet-5678
aws_instance.web   → i-01abc987
```

State also includes metadata and cached attributes that support planning. Its primary first-principles purpose, however, is identity: it tells Terraform which remote object belongs to each resource instance in the configuration.

Configuration, state, and remote reality answer different questions:

| Source | Question it answers |
| --- | --- |
| Configuration | What should the managed infrastructure look like? |
| State | Which remote objects are bound to Terraform addresses? |
| Provider API | What do those remote objects look like now? |

State is not a permanent claim that cached values are current reality. Suppose state previously recorded `t3.small`, but an operator manually changed the instance to `t3.large`. The configuration still asks for `t3.small`. During normal planning, Terraform uses the provider to refresh its view of the managed remote object. The comparison becomes:

```text
Configuration: t3.small
Previous state knowledge: t3.small
Refreshed AWS reality: t3.large
```

The difference between declared intent and out-of-band remote changes is called **drift**. A later plan can propose returning the remote value to `t3.small`, accepting the remote change by updating configuration, or taking another reviewed action. Terraform does not repair the drift merely because it exists; a run must observe it and an apply must execute an approved transition.

State must therefore be protected. Losing it can break Terraform's knowledge of ownership. Concurrent writers can calculate against inconsistent history. Provider-returned values may include sensitive information. A solo exercise may use a local `terraform.tfstate` file, while teams commonly use a protected remote backend and locking. Those details receive their own module later; here, the important point is that state is durable management data rather than a disposable cache.

## How Do Init, Plan, and Apply Form a Reconciliation Loop?
<!-- section-summary: Init prepares the working directory, plan calculates a proposed transition, and apply performs the approved graph of provider operations. -->

The three commands beginners meet first have different roles:

```bash
terraform init
terraform plan
terraform apply
```

`terraform init` prepares a working directory. Terraform Core does not ship every provider and reusable module inside one binary, so initialization installs the provider plugins and modules required by the configuration and prepares backend-related working data. If the files require `hashicorp/aws`, init obtains the compatible provider so Terraform can understand `aws_*` resource and data-source types.

Initialization does not compare desired infrastructure with reality. It equips Terraform to perform that comparison.

`terraform plan` performs the reasoning phase. Terraform reads configuration, uses state to identify managed objects, refreshes relevant remote information through providers, evaluates expressions, builds the dependency graph, and proposes operations. A plan might contain:

```text
+ create server
~ update server size
- destroy retired object
-/+ replace object
```

Planning separates the question “what would this declaration mean operationally?” from the act of changing production. A Git diff shows what text changed. A Terraform plan shows the expected infrastructure transition. Reviewers need both views because a one-line declaration change can imply a replacement or deletion.

`terraform apply` executes the approved transition. Core walks the dependency graph in a valid order, asks providers to perform the resource operations, receives remote identifiers and computed values, and updates state. If a plan contains a VPC, subnet, and server, the graph prevents Terraform from arbitrarily trying to attach a server to a subnet that does not exist yet.

The deeper loop is:

```text
DECLARE   what should exist
    ↓
OBSERVE   what managed reality looks like
    ↓
COMPARE   desired and observed state
    ↓
PLAN      a proposed transition
    ↓
REVIEW    operational consequences
    ↓
APPLY     provider operations in graph order
    ↓
RECORD    resulting identities and attributes
    ↺
```

Memorizing command order is useful, but this reconciliation model makes later topics predictable. Providers are needed to observe and change reality. State is needed to preserve identity. Plan is needed to expose the transition. Apply is needed because a calculated transition eventually has to become API operations.

## What Happens When Desired Infrastructure Changes?
<!-- section-summary: Adding, editing, or removing declarations changes desired state and can lead to create, update, replacement, or destroy actions. -->

Assume `aws_instance.web` exists and reality matches the configuration. Different edits create different comparisons.

Changing a property may produce an in-place update:

```diff
- instance_type = "t3.small"
+ instance_type = "t3.medium"
```

Whether this can update in place depends on provider and remote API semantics. Terraform Core recognizes a desired-value change; the provider explains the allowed lifecycle operation.

Adding another resource creates a desired object with no bound remote object:

```hcl
resource "aws_instance" "worker" {
  ami           = "ami-123456"
  instance_type = "t3.small"
}
```

Terraform can propose creating `aws_instance.worker`. If some argument cannot change in place, a different edit may require replacement: create a new remote object and destroy the old one in an order shaped by the resource and lifecycle rules.

Removing a resource block has a less intuitive meaning. In ordinary application code, deleting a line usually means the line stops executing. Terraform configuration describes desired reality. If state still binds `aws_instance.web` to `i-123` but the declaration disappears, Terraform normally concludes that the managed remote object is no longer desired and proposes destroying it.

This is why deleting infrastructure configuration deserves the same care as writing an explicit delete operation. Removing a production database block can eventually mean “delete the managed database,” not “stop discussing the database.” Configuration participates in the full resource lifecycle.

`terraform destroy` uses the same reconciliation model. Conceptually, destroy mode asks Terraform to calculate a plan whose desired managed set is empty:

```text
Current managed set: VPC, subnet, server, database
Desired managed set: ∅
Difference: remove every managed object
```

Terraform can order provider operations according to dependencies, but it cannot infer every business consequence. It may know how an API deletes a database without knowing that the database contains the only copy of seven years of customer records. Terraform understands declared lifecycle, provider behavior, and dependencies. Humans and organizational controls must also evaluate data retention, compliance, recovery, blast radius, and whether the change should happen at all.

Technical executability is therefore not the same as business safety. Plans, approvals, backups, retention controls, and carefully scoped ownership remain necessary even when Terraform can perform the API sequence correctly.

## Where Are Terraform's Important Boundaries?
<!-- section-summary: Terraform manages remote systems when invoked; data sources read without ownership, while modules, variables, and outputs compose the same underlying resource model. -->

Several boundaries prevent beginner mental models from becoming misleading.

First, Terraform is a management layer, not the cloud provider. An EC2 instance lives in AWS. Terraform stores configuration, logical-to-remote identity mappings, dependency information, and provider settings, then communicates with AWS. If the Terraform executable disappears, the instance does not disappear with it. The remote system still owns and runs the real object.

Second, Terraform is normally an **invoked reconciliation engine**, not a continuously running controller. A successful apply on Monday does not cause Terraform to watch the account every second. If someone changes AWS on Tuesday and no Terraform command or automation runs on Wednesday, the drift remains. A later plan can refresh and reveal it.

Third, management and lookup are different. A **resource** says, in effect, “Terraform owns the lifecycle of this object.” A **data source** asks a provider for information about an object without declaring that this configuration should create and manage it. If another team owns a shared production VPC, a data source can retrieve its ID while preserving that ownership boundary.

Fourth, **modules** solve composition and reuse rather than changing reconciliation. A module can group a network, subnets, load balancer, application servers, and monitoring behind a smaller interface. Terraform still ultimately plans resource instances inside the module.

**Input variables** let a configuration or module receive deliberate differences:

```hcl
variable "environment" {
  type = string
}
```

The same module can receive `dev` or `production` while preserving one implementation. **Outputs** expose useful results:

```hcl
output "load_balancer_dns" {
  value = aws_lb.app.dns_name
}
```

Variables, modules, resources, and outputs create a basic composition model:

```text
inputs → module → resources and relationships → outputs
```

These features make large configurations reusable and understandable, but they do not replace the core loop. Terraform still resolves configuration, identifies resource instances through state, observes remote systems through providers, plans changes, and applies approved operations.

## How Does the Complete Terraform Model Fit Together?
<!-- section-summary: Terraform combines durable intent, graph reasoning, provider-specific behavior, persistent identity, reviewable transitions, and invoked execution. -->

The complete architecture begins with people and version-controlled intent. A team writes configuration, supplies input values, and composes reusable modules. Resource references form a dependency graph. Terraform Core parses that graph and combines it with state and provider-refreshed remote data.

Providers sit at the boundary to real systems. They contribute resource types and data sources, translate arguments into platform-specific behavior, authenticate to APIs, inspect existing objects, and perform planned operations. State sits beside Core as durable memory connecting resource addresses to remote identities.

Before reality changes, the plan explains the proposed transition. After approval, apply walks the graph, performs provider operations, and records the resulting identities and attributes. The next run starts from that updated memory but refreshes remote information because reality may have changed independently.

![Terraform summary showing configuration, variables, modules, resources, Core, providers, APIs, state, plan, and apply](/content-assets/articles/article-iac-terraform-foundations-what-is-terraform/terraform-summary.png)

*The full model keeps each responsibility visible: humans declare intent, Core reasons about the graph, providers reach remote APIs, state preserves identity, and plan separates review from execution.*

A precise definition now has a reason behind every word: Terraform is an Infrastructure as Code system that uses declarative configuration, provider plugins, a dependency graph, and persistent state to calculate and execute transitions between the remote infrastructure it manages and the infrastructure a team says it wants.

The core concepts exist for specific first-principles reasons:

| Concept | Why it exists |
| --- | --- |
| Configuration | Terraform needs a durable description of desired infrastructure. |
| Provider | Core cannot contain every remote system's API and lifecycle semantics. |
| Resource | Terraform needs a logical unit representing a managed object. |
| Reference graph | Operations need data flow and valid ordering. |
| State | Logical addresses must remain bound to particular remote objects. |
| Plan | People need to inspect the transition before reality changes. |
| Apply | The approved transition must be executed through provider APIs. |
| Data source | A configuration sometimes needs remote information without lifecycle ownership. |
| Module | Large configurations need composition and reuse. |
| Destroy | A valid desired lifecycle can end with an object no longer existing. |

The most useful mental model is therefore not “`.tf` files create infrastructure.” It is:

```text
desired configuration
        +
resource identity in state
        +
observed remote infrastructure
        ↓
Terraform calculates a plan
        ↓
people or policy review the transition
        ↓
providers execute approved operations
        ↓
remote reality and state are updated
```

Once this model is clear, later Terraform topics stop looking like unrelated syntax. Provider installation prepares access to remote vocabulary. Resources create graph nodes. References create edges. State remembers ownership. Drift appears when remote reality changes independently. Plan calculates the difference. Apply performs it. Terraform is fundamentally a change-management and reconciliation system for long-lived external resources.

## Check Your Answers

:::expand[What Problem Does Terraform Solve?]{kind="recap"}
Terraform repeatedly compares declared intent with the remote objects it manages. It uses configuration, state, and provider-reported reality to calculate a transition rather than treating infrastructure as a one-time creation script.
:::

:::expand[How Do Configuration, Terraform Core, Providers, and Resources Work Together?]{kind="recap"}
Configuration declares logical resources. Core parses configuration, evaluates the graph, and plans lifecycle actions. Providers supply platform-specific types, API behavior, and authentication. A resource address names one managed object inside that model.
:::

:::expand[How Do Resource References Form a Dependency Graph?]{kind="recap"}
A reference passes one resource's result into another resource's argument and exposes the required ordering. Terraform uses those edges to create, update, and destroy objects in a valid graph order while allowing independent work to proceed concurrently.
:::

:::expand[Why Does Terraform Need State?]{kind="recap"}
State binds logical addresses such as `aws_instance.web` to particular provider objects such as `i-01abc987`. It preserves management identity and useful metadata, while provider refresh distinguishes previous state knowledge from current remote reality and exposes drift.
:::

:::expand[How Do Init, Plan, and Apply Form a Reconciliation Loop?]{kind="recap"}
Init installs required providers and modules and prepares the working directory. Plan combines configuration, state, and refreshed remote information into a proposed transition. Apply executes the approved dependency graph through providers and records the result.
:::

:::expand[What Happens When Desired Infrastructure Changes?]{kind="recap"}
Adding, editing, or removing declarations can produce create, update, replacement, or destroy actions. Removing code can mean removing a real managed object. Terraform can order deletion correctly without knowing whether the business consequence is acceptable.
:::

:::expand[Where Are Terraform's Important Boundaries?]{kind="recap"}
Terraform manages remote systems but is not the systems themselves, and it normally reconciles only when invoked. Resources own lifecycle; data sources read information. Modules, variables, and outputs compose the same underlying resource model.
:::

:::expand[How Does the Complete Terraform Model Fit Together?]{kind="recap"}
People declare intent; references form a graph; Core combines that graph with state and observed reality; providers translate operations into API calls; plan exposes the transition; and apply performs approved work. That reconciliation loop is Terraform's central model.
:::

### References

- [What is Terraform?](https://developer.hashicorp.com/terraform/intro) - Introduces Terraform and its write, plan, and apply workflow.
- [Terraform configuration language](https://developer.hashicorp.com/terraform/language) - Describes the declarative language used for resources, values, and modules.
- [Terraform providers](https://developer.hashicorp.com/terraform/language/providers) - Explains provider plugins and their connection to remote systems.
- [Terraform resources](https://developer.hashicorp.com/terraform/language/resources) - Documents managed resource types and lifecycle operations.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains state, resource bindings, and Terraform's remote-object memory.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - Documents normal planning and destroy mode.
