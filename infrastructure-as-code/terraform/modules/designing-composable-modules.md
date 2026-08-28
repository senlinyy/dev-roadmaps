---
title: "Designing Composable Modules"
description: "Terraform module structure that is easy to combine, test in isolation, and reuse without hidden dependencies."
overview: "Composable Terraform modules act as focused nodes in a larger dependency graph. This article shows how to choose module responsibilities, pass dependencies inward, publish intentional guarantees, keep discovery and provider context in the root, test contracts, and build a coherent module library."
tags: ["modules", "design", "composability", "terraform", "architecture"]
order: 4
id: article-iac-terraform-modules-composable
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/designing-composable-modules.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/designing-composable-modules.md
---

## Table of Contents

1. [What Makes a Terraform Module Composable?](#what-makes-a-terraform-module-composable)
2. [How Do You Choose One Coherent Responsibility?](#how-do-you-choose-one-coherent-responsibility)
3. [Why Should External Dependencies Come In as Inputs?](#why-should-external-dependencies-come-in-as-inputs)
4. [How Should Assumptions and Guarantees Shape the Interface?](#how-should-assumptions-and-guarantees-shape-the-interface)
5. [Why Should the Root Own Composition and Discovery?](#why-should-the-root-own-composition-and-discovery)
6. [How Do You Build a Composable Compute Module?](#how-do-you-build-a-composable-compute-module)
7. [How Does Composability Improve Testing?](#how-does-composability-improve-testing)
8. [How Do Composable Modules Form a Library?](#how-do-composable-modules-form-a-library)
9. [Check Your Answers](#check-your-answers)

The problem changes after a team creates several useful modules. The question is no longer how to place resources in folders. It is how to combine network, database, compute, bucket, and monitoring capabilities without making each one depend on the internal design of all the others.

Terraform already composes ordinary resources. A subnet needs a VPC ID, so one resource produces a value and another consumes it:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

The subnet does not create a VPC inside itself. It states a requirement through `vpc_id`, and the root connects `aws_vpc.main.id`. Terraform follows the reference to build an edge in the graph.

Module composition preserves the same pattern at a larger scale:

```hcl
module "network" {
  source = "./modules/network"

  cidr_block = "10.0.0.0/16"
}

module "compute" {
  source = "./modules/compute"

  subnet_ids = module.network.private_subnet_ids
}
```

Keep these questions in view as you work through the lesson:

1. **What Makes a Terraform Module Composable?**
2. **How Do You Choose One Coherent Responsibility?**
3. **Why Should External Dependencies Come In as Inputs?**
4. **How Should Assumptions and Guarantees Shape the Interface?**
5. **Why Should the Root Own Composition and Discovery?**
6. **How Do You Build a Composable Compute Module?**
7. **How Does Composability Improve Testing?**
8. **How Do Composable Modules Form a Library?**

## What Makes a Terraform Module Composable?
<!-- section-summary: A composable module accepts the dependencies it needs, performs one responsibility, and exposes small results without taking ownership of unrelated architecture. -->

The network module produces subnet IDs. The compute module requires subnet IDs. Neither needs to know the other's internal resources.

A module is composable when it can say: “give me the dependencies required for my responsibility, and I will perform that responsibility without owning unrelated parts of the system.” A compute module may need an image, subnets, security groups, instance size, and capacity. It does not need to know who created the VPC, how the image was discovered, whether the subnets live in another state, or which monitoring system consumes its results.

This definition distinguishes composition from simple reuse. A module can be called many times yet still be difficult to combine if it insists on creating every dependency or assumes one account naming scheme. Composability asks whether another root can connect the capability to different compatible producers and consumers without editing its implementation.

The graph view keeps the question concrete. Incoming edges are required values and assumptions. Internal nodes are the resources the module owns. Outgoing edges are supported results. Invisible lookups and unrelated resource creation are hidden edges, and hidden edges are what make apparently convenient modules surprising in new environments.

![Composable Root Wiring](/content-assets/articles/article-iac-terraform-modules-composable/composable-root-wiring.png)

Composability is therefore about explicit, small graph edges. Inputs form incoming edges, outputs form outgoing edges, and the module's internal graph stays behind the interface.

## How Do You Choose One Coherent Responsibility?
<!-- section-summary: One job means one meaningful capability whose resources change together, not one resource per module and not an entire unrelated environment. -->

The opposite of composition is a module that owns everything:

```text
application module
├── VPC and subnets
├── NAT gateways
├── AMI discovery
├── security groups
├── compute
├── database
├── buckets
├── monitoring
└── DNS
```

The first caller enjoys one short module block. Later callers reveal the coupling. Production already has a central VPC. Development uses a shared database. Security groups are managed centrally. Another team wants the compute pattern but not the network. The giant module accumulates switches such as `create_vpc`, `existing_vpc_id`, `create_database`, and `existing_database_arn`, followed by combinations of conditional behavior that are difficult to reason about.

Each switch adds more than one code path because options interact. “Create network but use existing database” differs from “join network and create database,” and ownership during destroy becomes harder to explain. The abstraction no longer expresses one promise; it becomes a miniature configuration language for assembling several unrelated systems inside the child.

The other extreme is one resource per module: separate wrappers for VPC, subnet, route table, IAM role, instance profile, launch template, Auto Scaling group, and security group. That adds interface indirection without necessarily creating useful abstractions.

“One job” means one coherent responsibility. A network module can contain a VPC, public and private subnets, routing, gateways, and NAT because those resources together implement the application's network. A compute-service module can contain an IAM role, instance profile, launch template, and Auto Scaling group because those resources implement scalable compute.

Ask whether the resources naturally evolve and are understood as one capability. Network changes may follow a new CIDR or routing strategy. Compute changes may follow a new instance type or scaling policy. Database changes may follow an engine or backup-policy decision. Monitoring may change independently of all three. Different reasons to change are strong signals for different boundaries.

Count is not the deciding metric. A network module with a dozen related resources can have one responsibility, while a three-resource module combining an unrelated bucket, DNS record, and database may have three reasons to change. The boundary should make design and operational ownership easier to describe.

A coherent boundary also gives ownership a clear name. `network`, `postgres`, `compute-service`, and `private-bucket` tell callers what promise they receive. “Everything for production” and “miscellaneous resources” hide several responsibilities behind one interface.

Flat composition is a strong default, but it is not a ban on nesting. A deliberate `standard-web-service` assembly may always contain load balancing, compute, standard alarms, and IAM under one organizational promise. Nesting is useful when it represents a genuine higher-level abstraction, not when it hides unrelated choices simply to shorten the root file.

This creates two useful levels. Building-block modules expose focused capabilities for roots that need custom composition. Assembly modules combine an intentionally standardized set for roots that want the higher-level promise. Both can coexist as long as callers understand which decisions the assembly fixes and which remain configurable.

Use change scenarios to test a proposed boundary. If adopting a new subnet strategy should not require a compute API change, network and compute probably deserve separate contracts. If every instance-profile change must travel with launch-template policy, those resources can remain in one compute capability. If DNS cutover follows a different team and approval schedule from database maintenance, putting both in one module may combine unrelated lifecycles even if the initial project used them together.

The boundary is successful when callers can describe the capability without listing its provider resources, and maintainers can name the policy those resources jointly implement. This is more durable than grouping by filename size or by the provider service prefix.

## Why Should External Dependencies Come In as Inputs?
<!-- section-summary: Dependency inversion lets a module depend on the shape and meaning it needs rather than one producer, discovery rule, or ownership model. -->

Suppose compute needs subnets. If the compute child creates a VPC and subnets itself, it is coupled to one network model. If it accepts `subnet_ids`, the caller can provide them from any compatible source:

```hcl
variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs where compute instances run."
}
```

Today the root may pass `module.network.private_subnet_ids`. Tomorrow it may pass `data.aws_subnets.application.ids` or `module.shared_network.private_subnet_ids`. Compute remains unchanged because it depends on a list of usable subnet IDs, not on the origin of those IDs.

The same rule applies to security groups, KMS keys, secret ARNs, hosted zones, database endpoints, and account-specific resource identities. If a value expresses an outside architectural dependency, make it visible in the input contract. This lets a plan reviewer trace the exact production object instead of reverse-engineering an internal lookup.

This is dependency inversion. Inputs should describe requirements rather than producers. `subnet_ids` is a stronger contract than `network_module_output` because the compute child does not care whether a module, resource, data source, remote-state interface, literal, or external system supplied the value.

Several related facts can enter as an object. Compute may require an image ID and architecture:

```hcl
variable "image" {
  type = object({
    id           = string
    architecture = string
  })
}
```

The root can provide a richer data-source object:

```hcl
data "aws_ami" "application" {
  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["myapp-*"]
  }
}

module "compute" {
  source = "./modules/compute"

  image = data.aws_ami.application
}
```

Terraform can accept a structurally compatible object containing more attributes than the child requires. The module's contract selects the small subset it needs and ignores producer-specific anatomy.

This structural behavior is powerful because it lets a data source or another module publish a rich value while the consumer stays narrow. The compute child says only “I require an ID and architecture.” It does not inherit the full provider schema as its public dependency.

Avoid “create it if it does not exist” behavior inside consumers. A compute module that sometimes creates a network and sometimes discovers one makes ownership ambiguous. Let the root choose an explicit architecture: call a module that creates a network or call a module/data source that joins an existing network, then pass the resulting interface to the same compute module.

The two producers can intentionally expose the same contract. One creates a dedicated VPC; the other discovers a shared VPC. Downstream compute receives `vpc_id` and `private_subnet_ids` either way. Ownership is clear because the selected producer, rather than a hidden conditional inside compute, represents the architecture.

![Module Leak Check](/content-assets/articles/article-iac-terraform-modules-composable/module-leak-check.png)

Hidden lookups are another form of coupling. If compute silently searches for a VPC, named security group, or company AMI, its real dependencies are absent from `variables.tf`. Different environments cannot substitute those choices easily, and tests must recreate the hidden naming convention. Passing stable identifiers makes the architecture and review evidence visible.

## How Should Assumptions and Guarantees Shape the Interface?
<!-- section-summary: Input validation states assumptions about dependencies, while small intentional outputs state the capabilities the module guarantees to consumers. -->

A reusable module makes assumptions about its inputs. If the compute implementation supports only `x86_64` images, encode the rule at the boundary:

```hcl
variable "image" {
  type = object({
    id           = string
    architecture = string
  })

  validation {
    condition     = var.image.architecture == "x86_64"
    error_message = "The compute module requires an x86_64 image."
  }
}
```

The assumption is now explicit and testable. The module promises to build its compute capability when the caller provides a compatible image and the other declared dependencies.

Outputs are guarantees. A compute implementation might contain an IAM role, instance profile, launch template, and Auto Scaling group, but monitoring may need only `autoscaling_group_name`, while another consumer needs `instance_role_arn`:

```hcl
output "autoscaling_group_name" {
  value       = aws_autoscaling_group.this.name
  description = "Name of the managed Auto Scaling group."
}

output "instance_role_arn" {
  value       = aws_iam_role.instance.arn
  description = "ARN of the role attached to compute instances."
}
```

Every output tells callers they may depend on that value. Publishing launch-template IDs, instance-profile internals, and entire provider resource objects creates a much larger compatibility commitment. A deliberately constructed object or a few capability-oriented outputs preserve more freedom to refactor.

Compare two output surfaces. One exposes the launch-template ID and version, role ID and name, profile ID, Auto Scaling group ID, ARN, and name. The other exposes only `autoscaling_group_name` and `instance_role_arn`. The first tells callers almost the entire internal anatomy. The second states the capabilities known consumers require.

Terraform allows an output to return a full resource object, but convenience can create an accidental provider-defined API. Callers may begin selecting arbitrary fields that the module author never intended to support. Construct a smaller object when several related outputs genuinely belong together, and make each public field deliberate.

The best interface combines low coupling with strong abstraction. Exposing every provider argument as a variable is technically flexible but merely moves provider syntax behind a wrapper. The module should still own policy such as IAM wiring, launch-template conventions, standard tags, and required controls. The caller supplies context: which image, subnets, security groups, capacity, account, and region.

This heuristic can be summarized as **policy inside, context outside**. It makes modules useful rather than empty pass-through layers while keeping environment-specific architecture out of generic children.

Flexibility is not the same as composability. Variables named `launch_template_everything`, `iam_role_everything`, or `autoscaling_everything` let callers configure mechanics but leave the module with little policy or meaning. A useful compute abstraction still decides how IAM, profiles, templates, tags, and scaling fit together; the caller selects the deployment context and legitimate sizing choices.

## Why Should the Root Own Composition and Discovery?
<!-- section-summary: The root intentionally knows the environment and wires reusable children, while provider configuration and environment-specific discovery remain outside generic component modules. -->

The root is the composition layer. It can make the architecture readable by connecting relatively flat child modules:

```hcl
module "network" {
  source = "./modules/network"

  cidr_block = "10.20.0.0/16"
}

module "security" {
  source = "./modules/security"

  vpc_id = module.network.vpc_id
}

module "compute" {
  source = "./modules/compute"

  subnet_ids = module.network.private_subnet_ids

  security_group_ids = [
    module.security.compute_security_group_id
  ]
}

module "monitoring" {
  source = "./modules/monitoring"

  autoscaling_group_name = module.compute.autoscaling_group_name
}
```

The “boring wiring” is useful. It states that this network feeds this security policy, these outputs feed this compute service, and this monitoring watches that Auto Scaling group. Hiding the connections under several nested children makes reviewers search for architecture that the root can show directly.

Because the connections use ordinary expressions, Terraform sees the same architecture. `vpc_id = module.network.vpc_id` and `autoscaling_group_name = module.compute.autoscaling_group_name` are both value flow and implicit dependency. Broad module-level `depends_on` would be less precise and can create unnecessary ordering or unknown values.

Flat module trees also create shorter addresses and simpler refactors. A resource under `module.compute` is easier to locate in a plan and move in state than one under a long chain such as `module.platform.module.application.module.compute`. Nested assemblies remain valid when the nesting expresses one intentional higher-level capability.

Environment-specific discovery usually belongs beside composition. Choosing an AMI and using one are different responsibilities:

```hcl
data "aws_ami" "application" {
  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["payments-prod-*"]
  }
}

module "compute" {
  source = "../../modules/compute-service"

  image = {
    id           = data.aws_ami.application.id
    architecture = data.aws_ami.application.architecture
  }
}
```

Production can choose an exact hardened image, development can select the latest development image, and tests can supply a controlled value. The compute child still performs one job. Root-owned discovery is a default, not an absolute rule: a module whose actual responsibility is to discover or join a shared network can own that lookup deliberately. The important point is that discovery belongs to a named responsibility rather than hiding inside an unrelated consumer.

The selected dependency can come from anywhere compatible. It may be a newly created module output, a provider data source, an imported resource, or an interface published by another state. The consumer contract remains stable because it describes requirements rather than provenance.

Provider configuration is another root-owned dependency. A reusable child declares its provider requirement:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}
```

The root supplies the configured AWS context—region, account, credentials, and any aliases. The child says “I require AWS”; the root decides which AWS identity and location this deployment uses.

The asymmetry is intentional. Child modules know less so they remain generic. The root knows which network, image, security policy, compute component, and monitoring component belong to one environment. Reusability comes from limiting child knowledge, not from making the root ignorant.

Provider aliases follow the same ownership rule. The root can decide that one child receives a differently configured AWS provider, while the child declares the local provider name it uses. Credentials and regions do not belong hard-coded inside a reusable component whose purpose is compute rather than environment selection.

Root visibility also helps plan review. When `module.compute` changes, the call shows its selected image and network inputs. When `module.monitoring` changes, its call shows which Auto Scaling group output it consumes. A deeply nested module may still be correct, but the reviewer must traverse more interfaces to answer those same questions. Prefer the smallest hierarchy that honestly represents the abstractions.

## How Do You Build a Composable Compute Module?
<!-- section-summary: A concrete compute-service module receives image and network context, owns its IAM and scaling mechanism, and publishes only the two capabilities consumers need. -->

Define the responsibility as a horizontally scalable EC2 compute service. It owns an IAM role, instance profile, launch template, and Auto Scaling group. It does not own the VPC, subnets, security groups, image discovery, or monitoring.

The input contract describes that boundary:

```hcl
variable "name" {
  type = string
}

variable "image" {
  type = object({
    id           = string
    architecture = string
  })

  validation {
    condition     = var.image.architecture == "x86_64"
    error_message = "The compute service requires an x86_64 image."
  }
}

variable "network" {
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "desired_capacity" {
  type    = number
  default = 2

  validation {
    condition     = var.desired_capacity >= 1
    error_message = "desired_capacity must be at least 1."
  }
}
```

Notice what is absent: VPC CIDRs, availability-zone selection, AMI naming rules, security-group ingress, region, and monitoring policy. Other components own those decisions.

The implementation turns supplied context into one compute capability:

```hcl
resource "aws_iam_role" "instance" {
  name = "${var.name}-instance-role"

  # Trust policy omitted for clarity.
}

resource "aws_iam_instance_profile" "this" {
  name = "${var.name}-instance-profile"
  role = aws_iam_role.instance.name
}

resource "aws_launch_template" "this" {
  name_prefix   = "${var.name}-"
  image_id      = var.image.id
  instance_type = var.instance_type

  vpc_security_group_ids = var.network.security_group_ids

  iam_instance_profile {
    name = aws_iam_instance_profile.this.name
  }
}

resource "aws_autoscaling_group" "this" {
  name                = var.name
  desired_capacity    = var.desired_capacity
  min_size            = 1
  max_size            = max(2, var.desired_capacity)
  vpc_zone_identifier = var.network.subnet_ids

  launch_template {
    id      = aws_launch_template.this.id
    version = "$Latest"
  }
}
```

The child owns how IAM, the instance profile, launch template, and Auto Scaling group fit together. It exposes only the intended guarantees:

```hcl
output "autoscaling_group_name" {
  value = aws_autoscaling_group.this.name
}

output "instance_role_arn" {
  value = aws_iam_role.instance.arn
}
```

The contract and implementation align. `var.image.id` reaches the launch template. `var.network.security_group_ids` attaches caller-selected security. `var.network.subnet_ids` places the Auto Scaling group. The role and profile remain module policy. Capacity has a default and a minimum validation. A reviewer can trace every external edge without finding a hidden data source inside the child.

The root can now compose the service:

```hcl
provider "aws" {
  region = "eu-west-2"
}

module "network" {
  source = "../../modules/network"

  cidr_block = "10.20.0.0/16"
}

module "security" {
  source = "../../modules/application-security"

  vpc_id = module.network.vpc_id
}

data "aws_ami" "application" {
  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["payments-prod-*"]
  }
}

module "compute" {
  source = "../../modules/compute-service"

  name = "payments-prod"

  image = {
    id           = data.aws_ami.application.id
    architecture = data.aws_ami.application.architecture
  }

  network = {
    subnet_ids = module.network.private_subnet_ids

    security_group_ids = [
      module.security.compute_security_group_id
    ]
  }

  instance_type    = "m7i.large"
  desired_capacity = 4
}

module "monitoring" {
  source = "../../modules/compute-monitoring"

  autoscaling_group_name = module.compute.autoscaling_group_name
}
```

Read top to bottom, this root is an architecture description. Network feeds security and compute. AMI discovery feeds compute. Compute publishes the Auto Scaling group name to monitoring. The references give Terraform the same graph; broad `depends_on` is unnecessary.

The approximate graph has network feeding both security and compute, security feeding compute, image discovery feeding compute, and compute feeding monitoring. Those edges arise from actual values, so Terraform can schedule operations and propagate unknown results without a separate imperative orchestration script.

Another root can replace the network producer with a `join-shared-network` module that exposes the same `vpc_id` and `private_subnet_ids`. Compute does not change. That interchangeability is the practical result of depending on a contract rather than an origin.

Composition also reduces knowledge. A tightly coupled compute module understands VPC naming, CIDR layout, subnet discovery, image naming, and monitoring ownership. This one knows only an image object, a network object, capacity, and its own internal compute policy. Knowing less about surroundings makes it easier to reuse.

## How Does Composability Improve Testing?
<!-- section-summary: Explicit dependencies create test seams, so contract and configuration tests can provide controlled inputs before narrower real-infrastructure integration tests. -->

A compute child that discovers an AMI, searches for a VPC, finds subnets, creates security groups, creates compute, and configures monitoring requires all of those conditions in every test. A child that accepts an image, network object, and capacity can be tested with controlled values.

The explicit interface creates a test seam. A native Terraform test can supply inputs and use a mock provider:

```hcl
mock_provider "aws" {}

run "uses_supplied_dependencies" {
  command = plan

  variables {
    name = "test-service"

    image = {
      id           = "ami-test"
      architecture = "x86_64"
    }

    network = {
      subnet_ids         = ["subnet-test"]
      security_group_ids = ["sg-test"]
    }

    desired_capacity = 2
  }

  assert {
    condition     = aws_launch_template.this.image_id == "ami-test"
    error_message = "Launch template did not use the supplied image."
  }

  assert {
    condition     = aws_autoscaling_group.this.desired_capacity == 2
    error_message = "Desired capacity was not applied."
  }
}
```

Mock-provider tests can inspect planned configuration without real credentials or infrastructure. They are useful for checking that input values reach the correct resource arguments and defaults apply as expected.

A separate validation test can supply an `arm64` image and expect the input validation to fail. Another can omit `instance_type` and confirm the planned launch template uses `t3.small`. These are contract behaviors, not cloud integration questions, so they should fail quickly and clearly.

Different layers answer different questions:

```text
contract tests → do invalid inputs fail and defaults work?
configuration tests → do supplied dependencies reach the intended resources?
integration tests → can the module create and operate real infrastructure?
```

The first two can often use mocks. The last uses a real provider, can create billable resources, and needs cleanup and an isolated account. A common workflow runs formatting, initialization, validation, and fast tests on every change, then uses controlled real-provider tests when the risk justifies them:

```bash
terraform fmt -check
terraform init
terraform validate
terraform test
```

Composability keeps tests small. The network module tests networking assumptions. Compute tests compute assumptions. Monitoring tests alarm behavior. An environment-level integration test then verifies their composition. No single component test needs to recreate the whole system.

This layered testing mirrors the module architecture. Small contracts support small test fixtures. Composition tests verify that compatible interfaces connect. Whole-system tests cover behavior that only appears when real provider resources interact. Keeping those questions separate improves failure diagnosis and limits unnecessary infrastructure creation.

Test the interface first. Confirm the architecture validation rejects an incompatible image. Confirm desired capacity reaches the Auto Scaling group. Confirm the intended output names are produced. These are the assumptions and guarantees callers actually rely on.

Then test module-owned policy. Confirm supplied network context is used rather than replaced by hidden discovery. Confirm standard IAM and launch-template choices remain present. A contract test proves which values the caller may choose; a configuration test proves the child applies those choices within its own policy.

Real-provider tests answer what mocks cannot: whether provider schemas, remote API rules, and resource interactions actually produce a working system. Run them in a disposable context, account for cost and cleanup, and keep them narrower than a whole-environment deployment where possible. The goal is not to make every test isolated from reality, but to reserve real infrastructure for questions that genuinely require it.

## How Do Composable Modules Form a Library?
<!-- section-summary: A module library becomes a set of compatible building blocks and deliberate assemblies whose small contracts let the root express one specific architecture. -->

A useful library can contain building blocks and higher-level assemblies:

```text
building blocks
├── network
├── postgres
├── compute-service
├── private-bucket
└── load-balancer

assemblies
├── standard-web-service
└── standard-data-platform
```

A root may wire building blocks directly, or call an assembly when the organization genuinely treats several pieces as one standardized capability. The danger is not nesting itself. It is an assembly that claims unrelated ownership and forces every consumer through a growing matrix of switches.

Think of the library as contracts:

```text
NETWORK
in:  cidr, zones
out: vpc_id, private_subnet_ids

SECURITY
in:  vpc_id
out: compute_security_group_id

COMPUTE
in:  image, subnet_ids, security_group_ids
out: autoscaling_group_name, instance_role_arn

MONITORING
in:  autoscaling_group_name
out: alarm_arns
```

![Composable Modules Field Guide](/content-assets/articles/article-iac-terraform-modules-composable/composable-modules-field-guide.png)

The modules deliberately know little about one another. Network does not know which application uses it. Security does not care who created the VPC. Compute does not know the network producer, image-discovery method, or monitoring owner. Monitoring does not know how compute acquired its network. Each knows only enough to satisfy its own contract.

That limited knowledge is not missing documentation; it is intentional decoupling. If compute begins importing network naming rules or monitoring configuration, the graph gains hidden edges and the library becomes harder to rearrange. Review module changes partly by asking what new outside knowledge the child is acquiring.

The root knows more on purpose. It selects the provider context and image, connects this network and security policy to this compute component, and directs this monitoring component to that result. Reusable children represent general capabilities; the root represents one environment-specific architecture.

Different environments can therefore assemble the library differently. A production root may create a dedicated network and use a carefully selected image. Development may join a shared network and use a development image. If both producers satisfy the same network and image contracts, the compute child remains identical.

The deepest model is a node with a small set of incoming and outgoing graph edges:

```text
image ───────────────┐
subnet IDs ──────────┤
security group IDs ──┼──▶ compute module ──▶ ASG name
capacity ────────────┘                     └─▶ role ARN
```

Poor design creates invisible edges: compute secretly selects an image, discovers a network, creates monitoring, chooses an account, and owns a database. Good composition makes those relationships explicit so Terraform can build its graph from normal references and humans can review the same architecture.

The core rules follow from that model. Give a child one meaningful responsibility. Pass outside dependencies in using requirement-oriented types. Encode assumptions in validation. Publish only intentional guarantees. Let the root choose provider context and compose outputs into inputs. Keep environment discovery near the composition that understands it. Prefer explicit ownership over “maybe create or find” behavior.

Composability does not mean exposing everything. The most reusable module is often the one that knows the least about its surroundings while still owning a strong internal policy. Low coupling plus a meaningful abstraction produces a useful building block; either property alone is insufficient.

Use an interface review for each library component:

```text
responsibility → can it be stated as one capability?
inputs → are outside dependencies explicit and origin-independent?
assumptions → are important compatibility rules validated?
outputs → are they stable guarantees with real consumers?
discovery → does the component choosing the environment own it?
providers → does the root supply deployment context?
tests → can controlled inputs exercise the contract?
ownership → is create versus join explicit?
```

The review should also identify invisible edges. A data source using a hard-coded company alias, an undeclared provider assumption, a child that silently creates a database, or an output returning an entire resource object can all couple modules more than their visible contract suggests.

Finally, keep composition and orchestration in perspective. Terraform does not need an imperative script to run the network module, capture its values, and then launch compute. The root expressions connect output to input in one declarative graph. Unknown values can flow through those edges, and providers execute operations when dependencies are ready. Designing modules well lets Terraform's native graph remain the orchestration mechanism.

This is why a module library is more than a collection of reusable directories. Its contracts form an architecture vocabulary. A root can say “this environment uses this network producer, this security policy, this compute capability, and this monitoring capability,” while each implementation remains focused enough to test and evolve. The library succeeds when new compositions require new root wiring rather than new hidden-condition branches inside every child.

Composition also improves replacement choices. If two network producers guarantee the same VPC and subnet outputs, a new root can select either without teaching compute about both implementations. If a future monitoring module accepts the same Auto Scaling group name, it can replace the current monitor at the root. Terraform has no formal interface declaration between those modules, so compatible types and documented semantics must carry that discipline.

Do not mistake matching attribute names for semantic compatibility. Two outputs called `private_subnet_ids` should also promise subnets appropriate for the consumer's workload, account, region, and routing assumptions. Use descriptions, validation where values allow it, and integration tests to make those assumptions visible. A composable contract is about meaning as well as shape.

The final design question is how much the child must know to fulfill its promise. Remove knowledge that the root or another focused component can own. Retain policy that defines the capability itself. Publish only what real consumers need. This produces a module that is neither an empty wrapper nor an all-knowing environment: it is one understandable node in a larger infrastructure graph.

When the module changes, repeat that check. A new lookup may introduce environment knowledge. A new output may expose internal anatomy. A convenience flag may combine two ownership models. A nested child may represent a useful assembly or merely hide wiring. Composability is maintained through these small interface decisions, not established permanently when the directory is first created.

Keep those choices explicit, reviewable, and testable at every release so the library can grow without turning its components into one tightly coupled system over time.

Composability is easiest to verify through callers. Create two small root modules that supply different valid inputs, consume only the documented outputs, and combine the module with another independent component. If callers must reach into resource addresses, duplicate naming rules, or know a hidden provider assumption, the boundary is leaking implementation. Refine the input and output contract rather than adding caller-specific branches. A composable module expresses one capability, leaves orchestration to the root, and permits versioned internal change without forcing every caller to understand its resource graph.

## Check Your Answers

:::expand[What Makes a Terraform Module Composable?]{kind="recap"}
A composable module receives explicit dependencies, performs one responsibility, and returns small capabilities. Its inputs and outputs become visible edges in Terraform's larger graph.
:::

:::expand[How Do You Choose One Coherent Responsibility?]{kind="recap"}
Group resources that implement one capability and change for related reasons. Avoid both giant environment modules and one-resource wrappers that add only indirection.
:::

:::expand[Why Should External Dependencies Come In as Inputs?]{kind="recap"}
Inputs let a child depend on required shapes such as subnet IDs instead of one producer, discovery convention, or ownership model. This is dependency inversion.
:::

:::expand[How Should Assumptions and Guarantees Shape the Interface?]{kind="recap"}
Validation makes input assumptions explicit. Small capability-oriented outputs state guarantees while preserving freedom to refactor internal provider resources.
:::

:::expand[Why Should the Root Own Composition and Discovery?]{kind="recap"}
The root knows the environment, chooses provider context and dependencies, performs environment-specific discovery, and makes child-to-child wiring visible as architecture.
:::

:::expand[How Do You Build a Composable Compute Module?]{kind="recap"}
The compute child accepts image and network context, owns IAM and scalable compute resources, and returns only the Auto Scaling group name and instance role ARN.
:::

:::expand[How Does Composability Improve Testing?]{kind="recap"}
Explicit inputs provide controlled test seams. Mocked contract and configuration tests stay small, while separate integration tests verify real provider behavior.
:::

:::expand[How Do Composable Modules Form a Library?]{kind="recap"}
Compatible building blocks and deliberate assemblies publish small contracts. Generic children know less, while the root holds the environment-specific knowledge needed to assemble them.
:::

### References

- [Module composition](https://developer.hashicorp.com/terraform/language/modules/develop/composition)
- [Creating modules](https://developer.hashicorp.com/terraform/language/modules/develop)
- [Providers within modules](https://developer.hashicorp.com/terraform/language/modules/develop/providers)
- [`depends_on` reference](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on)
- [Terraform tests](https://developer.hashicorp.com/terraform/language/tests)
- [Mock providers in tests](https://developer.hashicorp.com/terraform/language/tests/mocking)
