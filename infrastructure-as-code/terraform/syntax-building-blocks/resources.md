---
title: "Resources"
description: "Understand resources as logically addressed, state-tracked declarations that manage the lifecycle and values of remote infrastructure objects."
overview: "A resource is more than a create command. Learn how resource type and name form an address, how state binds that address to a remote ID, how arguments and attributes create dataflow, how unknown values still form a graph, and how plans choose create, no-op, update, replace, or destroy."
tags: ["resources", "lifecycle", "configuration", "terraform", "hcl"]
order: 3
id: article-iac-terraform-config-resources
aliases:
  - infrastructure-as-code/terraform/configuration/resources.md
---

## Table of Contents

1. [What Does a Terraform Resource Represent?](#what-does-a-terraform-resource-represent)
2. [How Do Resource Addresses and State Create Management Identity?](#how-do-resource-addresses-and-state-create-management-identity)
3. [How Do Arguments and Attributes Turn Resources into Values?](#how-do-arguments-and-attributes-turn-resources-into-values)
4. [How Do References and Unknown Values Form a Dependency Graph?](#how-do-references-and-unknown-values-form-a-dependency-graph)
5. [Which Lifecycle Actions Can a Plan Propose?](#which-lifecycle-actions-can-a-plan-propose)
6. [Why Is Replacement Different from an In-Place Update?](#why-is-replacement-different-from-an-in-place-update)
7. [How Do Multiple Instances and Address Changes Affect Identity?](#how-do-multiple-instances-and-address-changes-affect-identity)
8. [How Does a Resource Participate in Terraform's Long-Term Control Loop?](#how-does-a-resource-participate-in-terraforms-long-term-control-loop)
9. [Check Your Answers](#check-your-answers)

A Terraform **resource** answers a first-principles question: how can Terraform take responsibility for one real object outside Terraform?

Suppose AWS eventually contains an EC2 instance:

```text
EC2 instance
├── id: i-0834abc
├── type: t3.micro
└── subnet: subnet-123
```

Terraform needs a durable declaration saying which logical object it intends to manage and what that object should look like:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

This block is often misread as an instruction to execute “create EC2 instance.” Its fuller meaning is:

```text
A managed object should exist.
provider resource type = aws_instance
local Terraform name   = web
desired arguments      = selected AMI and t3.micro
```

The word **managed** matters. The block establishes a relationship that continues after the first apply. Terraform may create the object when absent, read and refresh it, update supported properties, replace it when an incompatible property changes, or destroy it when the desired declaration is removed.

Keep these questions in view as you work through the lesson:

1. **What Does a Terraform Resource Represent?**
2. **How Do Resource Addresses and State Create Management Identity?**
3. **How Do Arguments and Attributes Turn Resources into Values?**
4. **How Do References and Unknown Values Form a Dependency Graph?**
5. **Which Lifecycle Actions Can a Plan Propose?**
6. **Why Is Replacement Different from an In-Place Update?**
7. **How Do Multiple Instances and Address Changes Affect Identity?**
8. **How Does a Resource Participate in Terraform's Long-Term Control Loop?**

## What Does a Terraform Resource Represent?
<!-- section-summary: A resource block declares an ongoing management relationship with a remote object rather than a one-time create operation. -->

Terraform's ongoing responsibility is why the construct is called a resource rather than `create_server`. A creation command describes one moment. A resource declaration remains part of a repeated comparison between desired configuration and the managed remote object.

The provider defines which resource types exist. AWS, Azure, GitHub, DNS, Kubernetes, and other providers contribute their own types and lifecycle implementations. Terraform Core manages the general graph, state, plan, and apply process, while the provider understands the actual object schema and remote API.

![Terraform resource lifecycle showing one declaration moving through create, read, update or replace, and destroy while state preserves identity](/content-assets/articles/article-iac-terraform-config-resources/resource-lifecycle.png)

*A resource is a long-lived lifecycle declaration, not a command that blindly creates another object on every run.*

## How Do Resource Addresses and State Create Management Identity?
<!-- section-summary: The resource address is Terraform's logical identity, and state binds that address to one particular provider object. -->

The two labels in a resource block create Terraform identity:

```hcl
resource "aws_instance" "web" {
}
```

`aws_instance` is the provider-defined resource type. `web` is the local name inside the module. Together they form the address:

```text
aws_instance.web
```

That logical address differs from the remote identity AWS assigns, such as `i-0ca8419837`. Terraform state binds the two:

```text
Terraform address        state binding        AWS identity
aws_instance.web    ───────────────────────>  i-0ca8419837
```

Terraform needs its own address because provider-visible names are not reliable universal identity. Remote names may not exist, may not be unique, may change, or may be implemented as optional tags. State provides the explicit one-to-one management mapping.

The local label also does not automatically name the cloud object. This block:

```hcl
resource "aws_instance" "frontend" {
  ami           = "ami-123456"
  instance_type = "t3.micro"

  tags = {
    Name = "production-web-01"
  }
}
```

has Terraform address `aws_instance.frontend` and AWS-visible `Name` tag `production-web-01`. The first is Terraform's logical identity; the second is provider configuration for the remote object.

Merely writing a resource block does not claim an arbitrary object that already exists. If AWS already has `i-existing123`, Terraform does not automatically decide that it belongs to `aws_instance.web`. Normally Terraform creates a new object and records the binding. To adopt existing infrastructure, an explicit import operation establishes the address-to-remote-object relationship.

Terraform “ownership” is a recorded management relationship, not exclusive physical control. A person or another system can still change the remote object through the provider. On a later plan, Terraform refreshes that object and may detect drift from configuration. Provider-side access controls and organizational policy are needed if out-of-band modification should be prevented.

State contains cached attributes and metadata as well, but the deepest role is identity. Configuration alone cannot name `i-0ca8419837`, and AWS alone does not know that this instance is `aws_instance.web`. State joins the Terraform language to remote reality.

## How Do Arguments and Attributes Turn Resources into Values?
<!-- section-summary: Configuration supplies resource arguments, providers expose attributes, and the resulting resource value can feed other expressions. -->

A resource block normally supplies only part of the eventual object value:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

The configuration provides `ami` and `instance_type`. After AWS creates or refreshes the instance, the provider may expose `id`, `arn`, private and public IP addresses, availability zone, and other attributes.

```text
aws_instance.web
{
  ami               = "ami-123456"
  instance_type     = "t3.micro"
  id                = "i-08341abc"
  private_ip        = "10.0.1.27"
  availability_zone = "eu-west-2a"
  ...
}
```

**Arguments** are values the configuration supplies. **Attributes** are values the resource exposes. Some schema fields may be configurable and readable; others are computed entirely by the provider. Provider documentation defines the exact boundary.

A resource is therefore both a managed lifecycle object and a value in Terraform expressions. `aws_vpc.main` refers to the resource value, and `aws_vpc.main.id` selects its `id` attribute:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

Hard-coding `vpc-08394abc` would copy one remote implementation detail into configuration. Referencing `aws_vpc.main.id` says “use whichever provider ID belongs to this logical managed VPC.” If the remote identity changes through replacement, downstream configuration continues to follow the logical relationship.

Resource attributes can flow through an architecture:

```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.app.id
}

output "web_ip" {
  value = aws_instance.web.public_ip
}
```

The VPC supplies its ID to the subnet, the subnet supplies its ID to the server, and the server supplies its public IP to an output. Terraform configuration is not only a list of objects; it is a graph of object values.

## How Do References and Unknown Values Form a Dependency Graph?

A reference carries more than data. In this line:

```hcl
vpc_id = aws_vpc.main.id
```

Terraform learns both that the subnet needs a particular value and that producing that value depends on `aws_vpc.main`. The same idea applies when the subnet ID feeds an instance:

```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.app.id
}
```

Terraform can derive this order:

```text
aws_vpc.main
      │
      ▼
aws_subnet.app
      │
      ▼
aws_instance.web
```

The resources do not need to appear in that order in a file. Their references express the architecture, and Terraform turns those relationships into a dependency graph. This is why copying a remote ID into a string loses important information: the value may look correct, but the relationship that produced it is no longer visible to Terraform.

Some referenced values cannot exist until an API operation finishes. Before a new VPC is created, its provider-assigned ID is not available. A plan can therefore show:

```text
id = (known after apply)
```

This is an **unknown value**, not an error and not a guess. Terraform may already know the value's expected type, where it will come from, and which later operations must wait for it. It simply cannot know the concrete ID because the remote system has not generated one yet.

The distinction is important:

```text
unknown value
=
the dependency is understood,
but the final value does not exist yet

missing dependency information
=
Terraform cannot see the relationship at all
```

During apply, the provider creates the VPC and returns its ID. Terraform can then use that real value to create the subnet, use the subnet ID to create the instance, and finally expose the instance's public IP through an output. Planning remains meaningful even when some nodes of the value graph are still unknown.

![Resources form a value and dependency graph](/images/terraform/resources/resource-lifecycle.png)

## Which Lifecycle Actions Can a Plan Propose?

A resource declaration stays in configuration while the object moves through a lifecycle. Terraform reads the current managed object, compares it with the desired declaration and prior state, and proposes a transition. A useful shorthand is:

```text
desired configuration
        -
current managed object
        =
proposed plan
```

There are five normal outcomes.

| Desired condition | Current managed object | Typical result |
| --- | --- | --- |
| The resource should exist | It does not exist | Create |
| The resource already matches | It exists and matches | No-op |
| A property changed and the API supports editing it | It exists with an older value | Update in place |
| A property changed but the object cannot be edited that way | It exists with an incompatible value | Replace |
| The resource is no longer declared | It still exists and is managed | Destroy |

For a create, configuration contains an address such as `aws_instance.web`, but state has no corresponding object. Terraform asks the provider to create one, receives computed data such as the remote ID, and records the new binding.

For a no-op, configuration, refreshed remote information, and state agree. Re-running Terraform does not continually create more servers because the resource is a continuing management relationship, not a one-time command.

For an in-place update, the logical address and the remote identity remain the same while one or more properties change:

```text
before: aws_instance.web -> i-123, property A
after:  aws_instance.web -> i-123, property B
```

For a destroy, the configuration no longer includes a resource that state still associates with a remote object. In Terraform, deleting a block can therefore mean deleting real infrastructure. The block represents what Terraform should continue to manage, not merely a historical instruction that already ran.

A plan is valuable because it exposes the proposed lifecycle transition before apply. The symbols and details are not decorative output; they tell an operator whether a change is additive, harmless, mutable, destructive, or identity-changing.

## Why Is Replacement Different from an In-Place Update?

An update changes an existing remote object. A replacement removes one remote identity and establishes another under the same Terraform address.

Imagine a disk API whose location cannot be changed after creation. Configuration changes the desired location from London to Paris, but the API has no operation that moves that disk. The provider can satisfy the new declaration only by deleting the old disk and creating a new one.

```text
Terraform address: example_disk.data

before -> disk-123 in London
replace
after  -> disk-987 in Paris
```

The logical Terraform identity survives, while the physical remote identity changes. By contrast, an in-place update looks like this:

```text
Terraform address: aws_instance.web

before -> i-123 with property A
update
after  -> i-123 with property B
```

That difference can have serious operational consequences. A small configuration edit might preserve a running object, or it might recreate the object and everything tied to its old identity. That is why operators must inspect whether a plan proposes `~` for an update or delete-and-create actions for a replacement.

![An update preserves remote identity while replacement changes it](/images/terraform/resources/update-replace-decision.png)

Terraform Core does not invent the lifecycle rules for every service. Core recognizes that desired and current values differ, manages the graph, and constructs the plan. The provider defines the resource schema and translates that difference into the remote API's possibilities. One argument may support an in-place edit; another may require recreation. The provider's resource documentation is therefore the authority for the exact behavior of each argument.

Replacement also reinforces why Terraform keeps two identities. If the cloud ID were the only identity, replacement would make the resource look unrelated to its predecessor. The stable resource address lets configuration continue to refer to the same logical role even when the implementation of that role has to be rebuilt.

## How Do Multiple Instances and Address Changes Affect Identity?

A resource block usually creates one instance, but `count` and `for_each` let one block describe several individually addressed instances.

```hcl
resource "aws_instance" "web" {
  count = 3
}
```

This creates addresses such as:

```text
aws_instance.web[0]
aws_instance.web[1]
aws_instance.web[2]
```

With `for_each`, keys become part of the addresses:

```hcl
resource "aws_instance" "web" {
  for_each = {
    api   = "t3.micro"
    admin = "t3.small"
  }

  instance_type = each.value
}
```

The resulting instances are addressed as:

```text
aws_instance.web["api"]
aws_instance.web["admin"]
```

The block name `aws_instance.web` describes the resource as a whole, while each indexed or keyed address identifies one resource instance. State binds those individual instances to individual remote objects. Stable keys are therefore part of stable infrastructure identity.

The same identity rule explains why an apparently cosmetic rename deserves care. Suppose state contains:

```text
aws_instance.web -> i-123
```

Changing the label from `web` to `frontend` changes the address:

```text
aws_instance.web
becomes
aws_instance.frontend
```

Without an explicit move, Terraform can interpret this as the old managed resource disappearing and an unrelated new resource appearing. That may lead to destroy-and-create actions. A `moved` block lets you declare that the logical identity moved to a new address rather than being replaced:

```hcl
moved {
  from = aws_instance.web
  to   = aws_instance.frontend
}
```

Resource addresses are not cosmetic variable names. They are keys in Terraform's identity system. Review changes to labels, module paths, collection keys, and indexes with the same seriousness as changes to remote names or IDs.

## How Does a Resource Participate in Terraform's Long-Term Control Loop?

View configuration, state, the provider, and the remote system together to understand a resource fully:

```text
configuration declares desired properties
              │
              ▼
resource address names the logical object
              │
              ▼
state binds it to a remote identity
              │
              ▼
provider reads the actual remote object
              │
              ▼
plan compares desired and actual values
              │
              ▼
apply performs create, update, replace, or destroy
              │
              ▼
state records the resulting identity and attributes
```

The cycle can run again tomorrow. If a person changes the cloud object manually, the next refresh can reveal drift. Terraform's recorded ownership does not physically prevent other tools or people from changing the object; it means Terraform has an explicit management relationship with it.

State is sometimes described as a cache because it stores attributes such as IDs, IP addresses, tags, and previous values. Its deeper purpose is identity. Configuration alone cannot tell Terraform that `aws_instance.web` means `i-123`, and the cloud API cannot know that a particular server belongs to that Terraform address. State joins those naming systems.

Pre-existing infrastructure illustrates the point. Writing a resource block does not cause Terraform to claim whichever similar object it finds. The object must be created through that resource relationship or explicitly imported so that state contains the intended one-to-one binding. Import establishes management identity; it does not make Terraform the only actor capable of touching the object.

That one-to-one expectation protects the model from ambiguity. If two resource instances were both bound to the same remote server, Terraform could not safely decide which declaration owns a proposed change or deletion. Likewise, a resource block with no binding cannot safely select one object from hundreds of similar objects by guessing from a display name. The identity map must be explicit.

The separation between ownership and exclusive control also explains drift step by step. Imagine configuration and the last recorded state both describe a `t3.micro` instance. An operator changes the same EC2 instance to `t3.large` in the cloud console. The remote object is still the one bound to `aws_instance.web`, but its properties no longer match the desired declaration. A later plan can refresh that object through the provider, observe the larger type, and propose changing it back. State identifies **which** object to inspect; configuration decides **what** that object should look like.

The graph is reconstructed on every run from these logical relationships. File position is not the execution model. This configuration is deliberately written in a visually surprising order:

```hcl
resource "aws_instance" "web" {
  subnet_id = aws_subnet.app.id
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

Terraform still sees VPC, then subnet, then server because the references create those edges. Moving blocks between files in the same module does not change that relationship. By contrast, replacing a reference with a hard-coded identifier removes the dependency even if the text happens to be written below the resource it depends on.

The provider is involved at both ends of the loop. During refresh, it translates remote API responses into the resource's current attributes. During apply, it translates Terraform's planned action into create, read, update, or delete operations supported by that API. After the operation, it returns the new identity and computed values so Terraform can update state and continue evaluating dependent resources. Core coordinates the generic graph and state machinery; the provider supplies resource-specific meaning.

This also clarifies why the desired block is not a complete snapshot of the cloud object. You may configure only an image and instance type, while the provider reports an ID, ARN, availability zone, private address, public address, and other computed fields. Terraform can make those fields available to downstream expressions without requiring you to predict them. Some attributes are configurable and readable, some are computed only, and their exact rules belong to the provider schema.

Thinking in this loop helps with reviews. Ask four separate questions: Is the logical address stable? Is state bound to the intended remote object? Do the references describe the real dependency graph? Does the planned lifecycle action preserve or change remote identity? Those questions expose risks that are easy to miss when a resource block is treated as a simple API call.

The same model explains repeated runs. If the managed object already matches the declaration, the correct result is no action. If reality later diverges, the relationship remains available for another comparison. A resource is therefore durable intent attached to a durable logical address, not an instruction consumed and forgotten after its first successful apply.

That durable relationship is the central resource concept.

The complete definition is therefore broader than “a thing Terraform creates.” A Terraform resource is a logically addressed and state-tracked declaration through which Terraform manages the lifecycle of one or more remote objects. Its attributes carry values through the graph, its references establish dependencies, its provider supplies API-specific behavior, and plan/apply reconcile desired state with reality.

![A Terraform resource connects declaration, identity, dataflow, and lifecycle](/images/terraform/resources/resources-summary.png)

A resource block is only one side of the contract; provider read behavior and state together tell Terraform which real object the address represents. When a resource changes outside Terraform, refresh during planning can reveal drift and propose reconciliation. When the configuration removes the block, Terraform normally proposes destroying the object because the desired graph no longer contains it. Review lifecycle and replacement signals in the plan rather than assuming an in-place update, and never edit the remote object or state address casually when Terraform still owns the relationship.

## Check Your Answers

:::expand[What Does a Terraform Resource Represent?]{kind="recap"}
A resource block declares a remote object that Terraform should manage over time. It is not only a create command: the same declaration can lead to create, read, update, replacement, or destruction as desired and actual state change.
:::

:::expand[How Do Resource Addresses and State Create Management Identity?]{kind="recap"}
The resource address is Terraform's logical identity. State binds that address to a provider-assigned remote ID, allowing Terraform to know exactly which real object the declaration manages.
:::

:::expand[How Do Arguments and Attributes Turn Resources into Values?]{kind="recap"}
Arguments provide desired inputs, while attributes expose configured or computed results. Other expressions can read those attributes, so a resource also acts as a value in Terraform's dataflow.
:::

:::expand[How Do References and Unknown Values Form a Dependency Graph?]{kind="recap"}
A reference carries a value and an ordering relationship. Unknown values let Terraform preserve that relationship during planning even when a provider-generated value will not exist until apply.
:::

:::expand[Which Lifecycle Actions Can a Plan Propose?]{kind="recap"}
Comparing desired configuration with the current managed object can produce create, no-op, in-place update, replacement, or destroy. The plan previews that transition before any remote operation occurs.
:::

:::expand[Why Is Replacement Different from an In-Place Update?]{kind="recap"}
An update changes properties while preserving the remote object. Replacement keeps the Terraform address but swaps the old remote identity for a new one because the provider cannot apply the change in place.
:::

:::expand[How Do Multiple Instances and Address Changes Affect Identity?]{kind="recap"}
`count` and `for_each` give each resource instance an indexed or keyed address. Renames and key changes alter logical identity unless an explicit move preserves the existing state binding.
:::

:::expand[How Does a Resource Participate in Terraform's Long-Term Control Loop?]{kind="recap"}
Configuration declares the goal, state remembers identity, the provider reads and changes the remote object, and plan/apply reconcile differences. That loop makes a resource a continuing management relationship.
:::

### References

- [Create and manage resources overview](https://developer.hashicorp.com/terraform/language/resources)
- [Resource address reference](https://developer.hashicorp.com/terraform/cli/state/resource-addressing)
- [`resource` block reference](https://developer.hashicorp.com/terraform/language/block/resource)
- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
- [References to values](https://developer.hashicorp.com/terraform/language/expressions/references)
- [`terraform plan` command reference](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Provider resource lifecycle operations](https://developer.hashicorp.com/terraform/plugin/framework/resources)
- [State purpose](https://developer.hashicorp.com/terraform/language/state/purpose)
