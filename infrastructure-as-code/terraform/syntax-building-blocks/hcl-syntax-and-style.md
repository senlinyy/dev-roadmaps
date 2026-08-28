---
title: "HCL Syntax & Style"
description: "Learn how Terraform configuration uses blocks, labels, arguments, expressions, references, files, and canonical style to describe an infrastructure graph."
overview: "HCL gives Terraform a human-readable structure, while expressions and references create value flow and dependency edges. Learn to read blocks, types, variables, locals, resources, outputs, collections, module directories, common syntax mistakes, and the fmt-validate-plan workflow."
tags: ["terraform", "hcl", "syntax", "formatting"]
order: 1
id: article-iac-terraform-config-hcl-syntax
aliases:
  - infrastructure-as-code/terraform/configuration/hcl-syntax-and-style.md
---

## Table of Contents

1. [Why Does Terraform Need Structure and Dataflow?](#why-does-terraform-need-structure-and-dataflow)
2. [How Do Blocks, Labels, Arguments, and Expressions Fit Together?](#how-do-blocks-labels-arguments-and-expressions-fit-together)
3. [How Do Types, Collections, and String Templates Produce Values?](#how-do-types-collections-and-string-templates-produce-values)
4. [How Do Variables, Locals, Resources, and Outputs Move Values?](#how-do-variables-locals-resources-and-outputs-move-values)
5. [Why Do References Create a Dependency Graph Instead of File Order?](#why-do-references-create-a-dependency-graph-instead-of-file-order)
6. [How Do Files, Directories, and Modules Organize Configuration?](#how-do-files-directories-and-modules-organize-configuration)
7. [Which Style Rules and Syntax Mistakes Matter Most?](#which-style-rules-and-syntax-mistakes-matter-most)
8. [How Can You Read a Complete HCL Configuration?](#how-can-you-read-a-complete-hcl-configuration)
9. [Check Your Answers](#check-your-answers)

Terraform needs a language that can express both **structure** and **dataflow**. Structure says which kinds of configuration objects exist. Dataflow says where their values come from and how those objects relate.

Suppose the desired infrastructure contains a VPC, a subnet inside that VPC, and a web server inside the subnet. Terraform must learn more than three names:

```text
STRUCTURE
this object is a VPC
this object is a subnet
this object is a server

CONFIGURATION
VPC CIDR = 10.0.0.0/16
server size = t3.micro

RELATIONSHIPS
subnet belongs to VPC
server belongs to subnet
```

JSON can represent the same information, and Terraform supports `.tf.json` files. Native `.tf` files use HashiCorp Configuration Language, or HCL, because its block-oriented form is easier for people to read and edit:

```hcl
resource "aws_instance" "web" {
  instance_type = var.instance_type
  subnet_id     = aws_subnet.app.id
}
```

Read the example in two layers. Structurally, it declares a managed `aws_instance` named `web`. In the value graph, `instance_type` receives an input variable and `subnet_id` receives the provider-reported ID of another resource.

Keep these questions in view as you work through the lesson:

1. **Why Does Terraform Need Structure and Dataflow?**
2. **How Do Blocks, Labels, Arguments, and Expressions Fit Together?**
3. **How Do Types, Collections, and String Templates Produce Values?**
4. **How Do Variables, Locals, Resources, and Outputs Move Values?**
5. **Why Do References Create a Dependency Graph Instead of File Order?**
6. **How Do Files, Directories, and Modules Organize Configuration?**
7. **Which Style Rules and Syntax Mistakes Matter Most?**
8. **How Can You Read a Complete HCL Configuration?**

## Why Does Terraform Need Structure and Dataflow?
<!-- section-summary: HCL describes which Terraform constructs exist, while expressions and references explain where their values come from and how they depend on one another. -->

```text
STRUCTURE
managed resource
type = aws_instance
local name = web

DATAFLOW
var.instance_type ──> instance_type
aws_subnet.app.id ──> subnet_id
```

This is the central reading habit for HCL. Braces and equals signs are surface syntax. Underneath, blocks provide containers, arguments name required settings, expressions compute values, and references connect those values into a graph.

HCL is declarative. The order in which blocks appear is primarily for readers. Terraform evaluates relationships and dependencies rather than treating the file like a shell script that executes from the first line to the last.

![HCL block anatomy showing a resource block type, labels, arguments, expressions, and a nested block](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-block-anatomy.png)

*Classifying every piece as structure or value flow makes HCL predictable.*

## How Do Blocks, Labels, Arguments, and Expressions Fit Together?
<!-- section-summary: Blocks create configuration structure, labels identify a block in context, arguments assign expression results, and nested blocks describe child structure. -->

The general native-syntax shape is:

```hcl
block_type "label1" "label2" {
  argument_name = expression

  nested_block {
    argument_name = expression
  }
}
```

A **block** is a container with a type, optional labels, and a body. The type tells Terraform how to interpret the body. `terraform`, `provider`, `variable`, `locals`, `resource`, `data`, `module`, and `output` are different constructs even though all use block syntax.

```hcl
variable "environment" {
  type    = string
  default = "dev"
}
```

The outer `variable "environment" { ... }` is a block. Its type is `variable`; its one label identifies the input as `environment`. Inside the block, `type` and `default` are arguments.

Labels gain meaning from the block type. In:

```hcl
resource "aws_instance" "web" {
}
```

the first label is the provider-defined resource type and the second is Terraform's local name. Together they form the address `aws_instance.web`. In `variable "region"`, the label names the variable. In `module "network"`, the label names the module call. A label is therefore not a universal field; the owning block type defines its role.

An **argument** follows `name = expression`:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = "t3.micro"
}
```

`ami` and `instance_type` are argument names. The expressions on the right produce the values assigned to those arguments. Providers may also expose read-only **attributes**, such as a computed `id` or `arn`. An argument is a value the configuration supplies; an attribute is a value the object exposes for other expressions to read. Provider schemas decide which fields are configurable, computed, or both.

The right side is always an expression, even when it looks like a simple literal. All of these are expressions:

```hcl
"t3.micro"
3
true
var.instance_type
local.resource_name
aws_subnet.app.id
length(var.subnets)
var.environment == "prod" ? 3 : 1
```

That fact makes HCL flexible. The structure of `instance_type = ...` remains the same when a hard-coded string becomes `var.instance_type`. Only the source of the value changes.

Nested blocks and object expressions both use braces, which makes them easy to confuse:

```hcl
tags = {
  Name = "web"
}

lifecycle {
  create_before_destroy = true
}
```

`tags = { ... }` is an argument whose expression produces an object or map-like value. The equals sign marks value assignment. `lifecycle { ... }` is a nested block that Terraform interprets structurally. A practical reading rule is:

```text
name = { ... }  → argument with an object expression
name { ... }    → nested block
```

The provider or Terraform construct defines which arguments and nested blocks are legal. Similar punctuation does not mean interchangeable semantics.

Block types also control how many labels are allowed. A `resource` block needs a provider resource type and a local name. A `data` block similarly needs a data-source type and local name. `variable`, `output`, and `module` blocks each use one label. `locals` and `terraform` blocks use no label in their normal form. Reading the type first prevents you from assigning a universal meaning to the strings that follow it.

This also separates Terraform identity from provider-visible naming. The label `web` in `resource "aws_instance" "web"` exists so configuration can use the address `aws_instance.web`. It does not automatically name the EC2 instance `web`. A cloud-visible name usually comes from a provider argument, such as a `Name` tag. The two names may be similar for clarity, but they serve different systems.

Nested blocks deserve the same type-first reading. A `lifecycle` block is understood by Terraform itself. A provider-specific block such as a network or disk configuration is interpreted according to that resource's schema. When documentation shows repeated nested blocks, it may be describing a set of child structures rather than an object value. The schema, not visual resemblance alone, decides what the syntax accepts.

## How Do Types, Collections, and String Templates Produce Values?
<!-- section-summary: Every expression produces a typed value, and syntax should make strings, numbers, booleans, collections, nulls, and templates clear. -->

Expressions eventually produce values. Terraform's main value families include strings, numbers, booleans, lists and tuples, sets, maps and objects, plus the special `null` value. Arguments and variables expect compatible value shapes.

Primitive literals make their types visible:

```hcl
environment    = "production"
instance_count = 3
enabled        = true
```

Strings use quotes. Numbers and booleans normally do not. Writing `"3"` and `"true"` produces strings, not a number and a boolean. Terraform can sometimes convert primitive values when a context supplies an expected type, but explicit types communicate intent and avoid depending on an implicit conversion.

Collections model groups of infrastructure values. A sequence can be written with square brackets:

```hcl
availability_zones = [
  "eu-west-2a",
  "eu-west-2b",
  "eu-west-2c",
]
```

An object or map-like value uses braces after an equals sign:

```hcl
tags = {
  Environment = "production"
  Project     = "payments"
  ManagedBy   = "terraform"
}
```

These are expressions producing values. Elements can be selected with forms such as `var.availability_zones[0]` and `var.tags["Environment"]`, and later articles will transform collections with functions and comprehensions.

The first-principles type rule is simple: an argument expects a particular kind of value, and its expression must eventually produce a compatible type. A number cannot automatically stand in for a list of strings. A collection with one element type may not satisfy an object schema with named fields. Terraform's type diagnostics are explaining a mismatch between produced and required shapes.

The collection names describe useful differences. A list or tuple has an index and preserves element order, so `[0]` means something. A set represents unique members without making element position part of the interface. A map associates string keys with values of one general element type. An object has named attributes whose values can have different declared types. Terraform sometimes infers a more specific tuple or object type from a literal and converts it to a compatible collection type required by context.

`null` represents absence rather than an empty string, zero, or an empty collection. In many arguments it allows Terraform or the provider to behave as though no explicit value was supplied, although the exact effect depends on the receiving schema. Treat `null`, `[]`, `{}`, `""`, `0`, and `false` as different values; each carries different intent.

Type constraints on variables make that intent reviewable before a resource receives a value:

```hcl
variable "service" {
  type = object({
    name    = string
    port    = number
    enabled = bool
  })
}
```

Now callers must supply the expected named shape. A type declaration is not merely documentation: Terraform can reject incompatible input while the error is still close to the module boundary.

String interpolation has a narrower purpose than many older examples suggest. A direct reference should remain a direct expression:

```hcl
instance_type = var.instance_type
```

Wrapping it as `"${var.instance_type}"` is unnecessary when the argument needs the value itself. Interpolation is useful when constructing text from literal and dynamic parts:

```hcl
name = "${var.project}-${var.environment}-web"
```

Think in two cases:

```text
Need the value itself?
Use the direct expression: var.instance_type

Need to build a string?
Use a template: "${var.project}-${var.environment}"
```

A quoted reference is different again:

```hcl
instance_type = "var.instance_type"
```

This passes the literal characters `var.instance_type`; it does not look up the input. Quotes turn reference-looking text into a string.

## How Do Variables, Locals, Resources, and Outputs Move Values?
<!-- section-summary: Inputs enter through variables, reusable internal expressions receive local names, resources consume and produce values, and outputs expose selected results. -->

Terraform defines namespaces that show where a value comes from. The most common beginner flow is:

```text
input variables → local values → resource arguments
                                 ↓
                         resource attributes → outputs
```

An input variable declares part of a module's caller-facing interface:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"
}
```

Inside that module, its value is referenced as `var.environment`:

```hcl
resource "aws_instance" "web" {
  tags = {
    Environment = var.environment
  }
}
```

The declaration uses a `variable` block, while the expression uses the `var` namespace. `variable.environment` is not the reference syntax.

Local values name expressions used within a module. If several resources need a project-and-environment prefix, define it once:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"
}
```

Refer to it as `local.name_prefix`, using the singular namespace even though the declaration block is `locals`:

```hcl
tags = {
  Name = "${local.name_prefix}-web"
}
```

Locals reduce duplicated expressions and give domain meaning to transformations. They can refer to variables, resource attributes, data sources, functions, and other local values, provided the graph remains valid.

Managed resources also produce values. After the AWS provider handles:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
```

the expression `aws_vpc.main.id` can expose the provider-reported VPC ID. The three parts mean resource type, local resource name, and attribute. Another resource can consume it:

```hcl
resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

An output publishes a selected result:

```hcl
output "web_public_ip" {
  description = "Public IP address of the web server"
  value       = aws_instance.web.public_ip
}
```

Root-module outputs can be displayed to users or consumed by automation. Child-module outputs form part of the child module's interface and are read by a parent through `module.<name>.<output>`.

Other namespaces fit the same grammar:

| Value source | Reference form |
| --- | --- |
| Input variable | `var.environment` |
| Local value | `local.name_prefix` |
| Managed resource attribute | `aws_vpc.main.id` |
| Data-source attribute | `data.aws_ami.ubuntu.id` |
| Child-module output | `module.network.vpc_id` |

![HCL evaluation pipeline showing variables, locals, resource arguments, provider-computed attributes, and outputs](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-evaluation-pipeline.png)

*Values enter through inputs, move through named expressions and resource relationships, and leave through outputs.*

## Why Do References Create a Dependency Graph Instead of File Order?
<!-- section-summary: Resource references are data pipes and dependency edges, so Terraform orders operations from relationships rather than block or filename position. -->

Consider the VPC and subnet again:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

`aws_vpc.main.id` supplies the subnet's `vpc_id`, but it also tells Terraform that the subnet depends on the VPC. Terraform analyzes references to build its dependency graph:

```text
aws_vpc.main
      │ .id
      ▼
aws_subnet.app
```

The same value can continue into a server and output:

```text
var.vpc_cidr
      ↓
aws_vpc.main
      ↓
aws_subnet.app
      ↓
aws_instance.web
      ↓
output.server_id
```

References are therefore both value pipes and dependency edges. Terraform uses the graph to determine which operations must wait and which independent operations may run concurrently.

Block order does not establish that graph. These two resources can appear in the opposite textual order and Terraform still sees the dependency because the subnet expression refers to the VPC. Humans may prefer to place prerequisites first because the configuration reads more naturally, but source position is not the execution model.

Numeric filenames do not create operation order either. Files named `01-vpc.tf`, `02-subnet.tf`, and `03-server.tf` may help a reader, but Terraform does not execute them numerically. The actual relationship is expressed by references such as `subnet_id = aws_subnet.app.id`.

An explicit `depends_on` meta-argument exists for hidden dependencies that affect behavior without producing a natural value reference. It should not be added everywhere after learning that dependencies matter. If one resource's argument already references another resource, Terraform already knows the edge. Prefer ordinary dataflow because it explains both the dependency and the value being exchanged.

![Terraform parsing HCL files into value references and a resource dependency graph rather than a line-by-line script](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-parser-to-graph.png)

*Terraform combines HCL structure with expression references to build a graph; filenames and block order organize the code for people.*

## How Do Files, Directories, and Modules Organize Configuration?
<!-- section-summary: Files divide one module for human navigation, while directories create module boundaries that must be connected explicitly. -->

A directory may contain:

```text
terraform/
├── variables.tf
├── network.tf
├── compute.tf
└── outputs.tf
```

Terraform treats the `.tf` files in that directory together as one module configuration. `network.tf` does not create a separate namespace from `compute.tf`. A resource in one file can reference a resource in another without an import statement.

Conceptually:

```text
variables.tf ─┐
network.tf   ─┼─> one module
compute.tf   ─┤
outputs.tf   ─┘
```

File division is primarily for readers. A small module often uses `main.tf`, `variables.tf`, and `outputs.tf`. A larger module might use `network.tf`, `compute.tf`, `database.tf`, `iam.tf`, `providers.tf`, `locals.tf`, `variables.tf`, and `outputs.tf`. The goal is predictable navigation, not a file per resource or an imagined execution order.

Directories are a stronger boundary:

```text
app/
├── main.tf
└── modules/
    └── network/
        └── main.tf
```

Terraform does not automatically merge `modules/network/main.tf` into the parent. The nested directory is a child module and must be called explicitly:

```hcl
module "network" {
  source = "./modules/network"
}
```

A useful approximation is:

```text
file      ≈ human organization inside one module
directory ≈ module boundary and separate value interface
```

This distinction explains why moving a block between files in one directory usually does not change its address, while moving it into a child module changes its module path and interface. It also reinforces the graph model: Terraform combines all files in one module, evaluates references, and connects child modules through declared inputs and outputs.

Because files are merged at the module level, top-level names must remain unique within the relevant namespace. Splitting two blocks into different files does not allow both to declare `resource "aws_instance" "web"` in the same module. The file boundary does not hide one declaration from the other.

File organization should follow the size and review habits of the module. Keeping every block in `main.tf` is reasonable for a tiny example. Forcing a large production module into one file makes navigation and ownership harder. At the other extreme, one resource per file can scatter a small dependency graph across dozens of tabs. Group related infrastructure so a reader can predict where the network, compute, data, interface, provider, and local-value definitions live.

The same directory rule applies to automatically loaded filenames. Terraform reads files with the expected configuration suffix in the working module; a filename is not an import statement and does not grant sequencing. Generated or override-file conventions have specific behavior, so ordinary module structure should stay simple unless the project deliberately needs those mechanisms.

## Which Style Rules and Syntax Mistakes Matter Most?
<!-- section-summary: Canonical formatting, role-based names, useful comments, and clear expression syntax reduce review cost and prevent common misunderstandings. -->

Infrastructure code needs a higher standard than “the parser accepts it.” Small textual changes can cause large provider actions, so style should reduce the time and ambiguity involved in review.

`terraform fmt` rewrites configuration into Terraform's canonical formatting style:

```bash
terraform fmt
```

Idiomatic code uses consistent indentation, blank lines between logical groups, and familiar alignment:

```hcl
resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type

  tags = {
    Name        = local.server_name
    Environment = var.environment
  }
}
```

Consistent formatting is useful because reviewers can focus on meaning rather than personal layout. `terraform validate` asks a different question:

```bash
terraform validate
```

Formatting checks how code is written. Validation checks syntax and internal consistency without planning against remote infrastructure or state. A useful progression is:

```text
write → fmt → validate → plan

fmt:      Is it consistently written?
validate: Is the configuration internally valid?
plan:     What does it mean for managed reality?
```

Names should describe roles rather than repeat types. `aws_instance.aws_instance_web_server` repeats information already present in `aws_instance`. `aws_instance.web` is shorter, and references such as `aws_subnet.private.id`, `aws_security_group.web.id`, and `aws_db_instance.primary.endpoint` read like architectural statements.

Comments should explain reasons that syntax cannot express. This comment adds little:

```hcl
# Set instance type
instance_type = "t3.micro"
```

This one preserves a constraint:

```hcl
# Keep this family because the vendor license is tied to x86_64.
instance_type = "t3.micro"
```

Terraform accepts `#`, `//`, and block comments, while `#` is the common style. Comments should record why a non-obvious decision exists rather than translate a readable assignment into English.

Common beginner errors usually come from confusing identity, values, and graph order:

1. **Confusing a Terraform label with a provider-visible name.** In `resource "aws_instance" "web"`, `web` creates the Terraform address `aws_instance.web`. A cloud-visible name normally needs a provider argument such as a `Name` tag.

2. **Quoting a reference.** `var.instance_type` reads an input. `"var.instance_type"` is literal text.

3. **Forgetting string quotes.** `"production"` is text. Unquoted `production` is parsed as a reference-like identifier and is invalid unless that symbol exists in the expression context.

4. **Mixing declaration and reference namespaces.** Declare `variable "environment"`, then read `var.environment`. Declare values inside `locals`, then read `local.name`.

5. **Using interpolation for every value.** Use a direct reference when the value stands alone and `${...}` when embedding an expression inside a string template.

6. **Assuming file order controls execution.** Dependencies come from references and occasional explicit hidden dependencies, not numbered filenames.

7. **Overusing `depends_on`.** A natural attribute reference already creates the edge and explains the dataflow. Reserve explicit dependency metadata for relationships that cannot be expressed by a value reference.

These are not merely punctuation mistakes. Each reflects an incorrect mental model about local identity, typed values, namespaces, or graph construction.

One more subtle error is confusing an argument with an attribute. Provider documentation may show `id`, `arn`, an endpoint, or another value that appears after apply. That does not mean the resource block accepts the same name as configurable input. Read the provider schema or documentation to see which values are required or optional arguments and which are computed results. HCL can parse a name syntactically while the provider schema still rejects it semantically.

Validation has a similar boundary. `terraform validate` can confirm that references, types, and configuration structure are internally coherent with the installed providers. It does not prove that credentials work, remote quotas are available, the selected AMI exists in the configured region, or the planned infrastructure is safe for the business. Those questions need planning, policy, review, and runtime verification.

## How Can You Read a Complete HCL Configuration?
<!-- section-summary: A complete reading starts with block purpose, then labels, arguments, expression sources, and finally the value and dependency graph. -->

Consider a complete small configuration:

```hcl
variable "project" {
  type        = string
  description = "Project name"
}

variable "environment" {
  type        = string
  description = "Deployment environment"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR range for the VPC"
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"

  tags = {
    Name = "${local.name_prefix}-app"
  }
}

resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id

  tags = {
    Name = "${local.name_prefix}-web"
  }
}

output "web_instance_id" {
  description = "ID of the web instance"
  value       = aws_instance.web.id
}
```

Read it with a compact grammar. For each block, ask what kind of Terraform construct it is and what identity or context its labels supply. For each argument, ask which property is configured and what value shape it expects. For each expression, classify the source:

```text
"hello"                     → literal string
var.x                       → module input
local.x                     → named internal expression
aws_vpc.main.id             → managed resource attribute
data.aws_ami.ubuntu.id      → data-source attribute
module.network.vpc_id       → child-module output
length(var.subnets)         → function result
```

Then draw the value graph:

```text
var.project ────────┐
                    ├─> local.name_prefix ──> resource tags
var.environment ────┘

var.vpc_cidr ──> aws_vpc.main
                       ↓ .id
                 aws_subnet.app
                       ↓ .id
                 aws_instance.web
                       ↓ .id
              output.web_instance_id
```

The text is split into blocks and perhaps several files for human navigation. Terraform sees structured objects, typed expression values, and dependency edges.

The three variables do not all flow to the same place. `var.project` and `var.environment` combine inside `local.name_prefix`; `var.vpc_cidr` goes directly to the VPC. The local then feeds three provider-visible `Name` tags. The VPC's computed ID flows to the subnet, the subnet's ID flows to the server, and the server's ID becomes a module output.

That reading predicts planning behavior. Terraform can evaluate the input strings and local template before any provider operation. The VPC ID, subnet ID, and instance ID may remain unknown until their resources are created, but their relationships are already known. Terraform can therefore build the graph before it knows every eventual value. “Unknown until apply” is a value state inside a known dependency structure, not evidence that Terraform lacks an execution plan.

It also predicts how an edit propagates. Changing `var.environment` affects the local prefix and therefore several tags. Changing `var.vpc_cidr` affects the VPC and may have consequences for dependent infrastructure according to provider rules. Changing only the output description affects documentation but not the resource graph. A reader who traces values can estimate the part of the plan that deserves attention before running Terraform.

Finally, notice what the configuration does not claim. The textual position of `output` does not cause it to execute last; its reference places it after the instance value in the graph. The subnet does not wait for the VPC merely because the VPC block appears first; it waits because `vpc_id` consumes `aws_vpc.main.id`. HCL is readable text that declares a graph, and those two layers must be understood together.

![HCL summary showing blocks, arguments, expressions, references, files, module directories, and the resulting dependency graph](/content-assets/articles/article-iac-terraform-config-hcl-syntax/hcl-summary.png)

*The complete reading method moves from syntax classification to value origin and finally to the graph Terraform will evaluate.*

The core model is:

```text
BLOCKS
What kinds of configuration objects exist?
        ↓
ARGUMENTS
Which properties do they need?
        ↓
EXPRESSIONS
Which typed values should those properties receive?
        ↓
REFERENCES
Where do those values come from?
        ↓
DEPENDENCY GRAPH
What depends on what?
```

Once HCL is read as structure plus dataflow plus dependencies, unfamiliar Terraform becomes easier to navigate. The remaining syntax topics add richer expression and lifecycle tools, but they continue to operate inside this same model.

## Check Your Answers

Formatting is mechanical, while naming and structure communicate the graph. Run `terraform fmt`, use consistent identifiers, prefer references over duplicated literals, and organize files for readers rather than imagined execution order. Comments should explain intent or constraints that HCL cannot express, not restate the syntax. A readable configuration lets reviewers trace how an input becomes a local expression, resource argument, dependency edge, and output before relying on the plan for the concrete actions.

:::expand[Why Does Terraform Need Structure and Dataflow?]{kind="recap"}
HCL describes which configuration objects exist, while expressions describe the values they need. References connect those values, turning readable files into the data and dependency graph Terraform evaluates.
:::

:::expand[How Do Blocks, Labels, Arguments, and Expressions Fit Together?]{kind="recap"}
A block supplies structure, its type defines what labels mean, arguments assign values, and expressions produce those values. `name = {}` is usually an object-valued argument, while `name {}` is a nested block.
:::

:::expand[How Do Types, Collections, and String Templates Produce Values?]{kind="recap"}
Expressions produce typed values such as strings, numbers, booleans, collections, objects, or null. Use direct references for values and interpolation only when constructing strings from literal and dynamic parts.
:::

:::expand[How Do Variables, Locals, Resources, and Outputs Move Values?]{kind="recap"}
Variables receive caller input, locals name internal expressions, resources consume arguments and expose attributes, and outputs publish selected results. Their namespaces make the source of each value visible.
:::

:::expand[Why Do References Create a Dependency Graph Instead of File Order?]{kind="recap"}
A resource reference passes an attribute and tells Terraform that the consumer depends on the producer. Terraform orders operations from those edges, not block position or numeric filenames. Use `depends_on` only for hidden relationships.
:::

:::expand[How Do Files, Directories, and Modules Organize Configuration?]{kind="recap"}
Terraform combines all `.tf` files in one directory into one module, so files organize code for people. A different directory is a module boundary that must be called explicitly and connected through inputs and outputs.
:::

:::expand[Which Style Rules and Syntax Mistakes Matter Most?]{kind="recap"}
Canonical formatting, role-based names, useful comments, and predictable files lower review cost. Common mistakes confuse labels with provider names, strings with references, declaration blocks with namespaces, and source order with dependency order.
:::

:::expand[How Can You Read a Complete HCL Configuration?]{kind="recap"}
Classify each block, label, argument, and expression; identify the type and source of every value; then trace references into a graph. That method reveals the configuration's real meaning more clearly than reading it as a line-by-line script.
:::

### References

- [Terraform native syntax](https://developer.hashicorp.com/terraform/language/syntax/configuration) - Defines blocks, arguments, identifiers, comments, and native HCL syntax.
- [Terraform language overview](https://developer.hashicorp.com/terraform/language) - Explains blocks, arguments, expressions, and configuration structure.
- [Expressions](https://developer.hashicorp.com/terraform/language/expressions) - Documents literals, references, operators, functions, and other expression forms.
- [Types and values](https://developer.hashicorp.com/terraform/language/expressions/types) - Describes primitive, collection, structural, and null values.
- [References to values](https://developer.hashicorp.com/terraform/language/expressions/references) - Defines variable, local, resource, data-source, and module namespaces.
- [Terraform style guide](https://developer.hashicorp.com/terraform/language/style) - Provides formatting, naming, and file-organization guidance.
- [Files and configuration structure](https://developer.hashicorp.com/terraform/language/files) - Explains how files in a module directory are combined.
- [terraform fmt](https://developer.hashicorp.com/terraform/cli/commands/fmt) and [terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate) - Document formatting and validation as separate checks.
