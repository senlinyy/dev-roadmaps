---
title: "Data Sources: Querying Infrastructure"
description: "Safe read-only provider queries for referencing and consuming pre-existing infrastructure."
overview: "A data source is a read-only lookup that lets Terraform use existing infrastructure without taking ownership of it. This article contrasts resources that Terraform manages with data sources that Terraform reads, then shows filters, plan output, state behavior, and safer use around secret data."
tags: ["terraform", "data-sources", "querying", "state"]
order: 4
id: article-iac-terraform-config-data-sources
aliases:
  - infrastructure-as-code/terraform/data-sources.md
  - infrastructure-as-code/terraform/configuration/data-sources.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/data-sources.md
---

## Table of Contents

1. [Why Does Terraform Need Data Sources?](#why-does-terraform-need-data-sources)
2. [How Do Resources and Data Sources Differ?](#how-do-resources-and-data-sources-differ)
3. [How Does a Lookup Become a Terraform Value?](#how-does-a-lookup-become-a-terraform-value)
4. [How Do References Replace Hard-Coded Identities?](#how-do-references-replace-hard-coded-identities)
5. [When Does Terraform Read a Data Source?](#when-does-terraform-read-a-data-source)
6. [How Do Provider Context and Multiple Lookups Shape Results?](#how-do-provider-context-and-multiple-lookups-shape-results)
7. [Why Do Data Sources Create State and Security Concerns?](#why-do-data-sources-create-state-and-security-concerns)
8. [How Do You Choose the Right Source for a Value?](#how-do-you-choose-the-right-source-for-a-value)
9. [Check Your Answers](#check-your-answers)

A resource tells Terraform to manage an object. A data source tells Terraform to observe an object owned elsewhere and turn its facts into Terraform values.

Terraform builds a graph of desired objects, values, and dependencies. A resource such as:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

does not spell out a sequence of API calls. It declares a managed server, and Terraform Core works with the provider to create, read, update, or delete that object as needed.

Now suppose a platform team already owns a shared VPC:

```text
name: production-shared
id:   vpc-abc123
```

An application configuration needs the VPC ID but should not create or control the network. Hard-coding it works technically:

```hcl
resource "aws_security_group" "app" {
  vpc_id = "vpc-abc123"
}
```

but the module now contains one environment-specific remote identity. Development may use another ID, and the network team may later replace the shared VPC. The real intent is “find the shared VPC matching these criteria and use its current ID.”

Keep these questions in view as you work through the lesson:

1. **Why Does Terraform Need Data Sources?**
2. **How Do Resources and Data Sources Differ?**
3. **How Does a Lookup Become a Terraform Value?**
4. **How Do References Replace Hard-Coded Identities?**
5. **When Does Terraform Read a Data Source?**
6. **How Do Provider Context and Multiple Lookups Shape Results?**
7. **Why Do Data Sources Create State and Security Concerns?**
8. **How Do You Choose the Right Source for a Value?**

## Why Does Terraform Need Data Sources?

That is a query:

```hcl
data "aws_vpc" "shared" {
  # provider-specific lookup criteria
}
```

The provider reads the external system and returns attributes to Terraform:

```text
external reality
      │
      │ provider query
      ▼
data source
      │
      │ Terraform values
      ▼
configuration graph
```

![A data source turns an external fact into a Terraform value](/content-assets/articles/article-iac-terraform-config-data-sources/data-source-lookup-path.png)

Data sources exist because not every dependency should be managed in the current state. An account identity, existing network, DNS zone, availability-zone set, or approved image can be externally owned while still supplying information that this configuration needs.

## How Do Resources and Data Sources Differ?

The central question is ownership.

| Question | Resource | Data source |
| --- | --- | --- |
| Primary job | Manage infrastructure | Discover information |
| Creates objects | Yes | No |
| Updates objects | Yes | No |
| Deletes objects | Yes | No |
| Reads objects | Yes | Yes |
| Owns lifecycle in this configuration | Yes | No |
| Declaration | `resource` | `data` |
| Reference example | `aws_vpc.main.id` | `data.aws_vpc.main.id` |

This resource declaration says Terraform is responsible for the VPC's desired lifecycle:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
```

This data declaration says another owner controls the VPC and Terraform only reads it:

```hcl
data "aws_vpc" "main" {
  id = "vpc-123456"
}
```

Provider data sources are read operations intended not to change infrastructure. Their query results can influence later resource changes, but the data-source read itself does not claim create, update, replace, or destroy authority over the matched object.

Use a resource when this configuration should control the object. Use a data source when it only needs facts about an object managed somewhere else. If an existing object should become managed here, merely reading it is not enough; represent it as a resource and import the remote identity into that resource's state binding.

“Existing” and “data source” are not synonyms. A pre-existing server can be imported and managed as a resource. A newly discovered image can remain external and read-only. Ownership, not age, decides the construct.

## How Does a Lookup Become a Terraform Value?

The basic syntax is:

```hcl
data "<TYPE>" "<LOCAL_NAME>" {
  # query arguments
}
```

For example:

```hcl
data "aws_ami" "app" {
  most_recent = true
  owners      = ["self"]

  tags = {
    Name   = "app-server"
    Tested = "true"
  }
}
```

`aws_ami` is a data-source type implemented by the AWS provider. It defines the accepted query arguments and returned attributes. `app` is the local name chosen for this query inside the module. Returned values use:

```text
data.<TYPE>.<NAME>.<ATTRIBUTE>
```

so the image ID is:

```hcl
data.aws_ami.app.id
```

A data source can be understood as a provider-specific function:

```text
lookupAMI(
  owners = ["self"],
  name   = "app-server",
  tested = true,
  newest = true
)
```

The remote system may return an object containing an ID, architecture, name, owner ID, and other fields. Terraform makes those results available through references such as:

```hcl
data.aws_ami.app.id
data.aws_ami.app.architecture
data.aws_ami.app.name
```

Terraform defines the general `data` mechanism; the provider documentation defines what each type queries, how matching works, and which attributes it returns. A lookup can fail when nothing matches, when filters are too broad and multiple objects match, or when the provider cannot access the required read API.

The data block itself is a participant in Terraform's value graph, not an imperative command embedded at a particular file position. Its arguments can be expressions, and its results can feed resources, modules, locals, outputs, or other data sources.

## How Do References Replace Hard-Coded Identities?

A discovered AMI can configure a managed server:

```hcl
data "aws_ami" "app" {
  most_recent = true
  owners      = ["self"]

  tags = {
    Name = "app-server"
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.app.id
  instance_type = "t3.micro"
}
```

The reference carries the returned value and an implicit dependency:

```text
AWS image catalog
       │
       ▼
data.aws_ami.app
       │ .id
       ▼
aws_instance.web
```

Terraform knows the instance configuration cannot be fully determined until the lookup provides its ID. There is normally no need to add `depends_on = [data.aws_ami.app]`; the value reference gives Terraform more precise dependency information.

Compare the two meanings:

```hcl
ami = "ami-0ab123"
```

says “use this exact remote identity.”

```hcl
ami = data.aws_ami.app.id
```

says “find an object matching this relationship and use the identity it currently has.” Data sources can therefore remove environment-specific IDs and help modules remain reusable.

Dynamic discovery is not automatically safer. With `most_recent = true`, today's query might return `ami-v1` and next month's identical query might return `ami-v2`. The configuration text did not change, but external reality did. A later plan could replace servers because the discovered image changed.

The design question is whether a dependency should float or be pinned. Dynamic discovery often suits current account ID, region, availability zones, DNS zone, or an existing network. Reproducibility may be more important for machine images, artifacts, database snapshots, and release versions. A data source turns external facts into live inputs; choose query constraints with that movement in mind.

## When Does Terraform Read a Data Source?

When all query arguments are known, Terraform normally tries to read the data source during planning or refresh. For the AMI query, it can build the graph, ask AWS for the match, receive a concrete image ID, and use that ID in the planned server:

```text
terraform plan
      │
      ├── evaluate known query arguments
      ├── provider reads image catalog
      ├── data.aws_ami.app.id = "ami-123"
      └── plan aws_instance.web with ami = "ami-123"
```

A read must be deferred when one of its inputs does not exist yet:

```hcl
resource "aws_something" "example" {
  # ...
}

data "some_data_source" "lookup" {
  object_id = aws_something.example.id
}
```

Before creation, the resource ID is `(known after apply)`. Terraform cannot execute `lookup(object_id = unknown)`. The apply path is:

```text
create resource
      │
      ▼
receive object ID
      │
      ▼
read data source
      │
      ▼
receive query result
```

During the plan, the data-source result and values that depend on it remain unknown. This is a consequence of available information, not unpredictable execution.

![A lookup runs during planning when its inputs are known and waits for apply when they are not](/content-assets/articles/article-iac-terraform-config-data-sources/unknown-value-timing.png)

Unknownness can propagate through a chain:

```text
resource A produces unknown ID
            │
            ▼
data source B cannot run yet
            │
            ▼
resource C receives unknown argument
```

Terraform can still preserve the graph and plan whatever is knowable. Once apply resolves the earlier node, later reads and operations continue in dependency order.

Sometimes a real dependency is not represented by a value. A lookup might require a permission resource to exist even though none of its query arguments references that permission:

```hcl
data "some_service" "lookup" {
  name = "example"

  depends_on = [
    something.permission
  ]
}
```

Use explicit `depends_on` only for such hidden relationships. It can make planning more conservative and leave additional values unknown until apply. Ordinary expression references remain preferable because they describe both the dependency and the exact data being transferred.

## How Do Provider Context and Multiple Lookups Shape Results?

A provider performs every lookup within a particular context. For AWS, that context can include region, account credentials, an alias, and endpoint configuration:

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

The same filters can return different results in another region or account. A useful equation is:

```text
data-source result
= query criteria
  + provider context
  + current external reality
```

When nothing or too much matches, first verify all three terms. Common failures include the wrong region, project, subscription, account, or aliased provider; credentials without permission for the read; filters that are too narrow or too broad; unknown inputs; and an external object that changed since the last run.

Each failure category follows directly from treating the block as a real remote query. “Nothing matched” can mean the object does not exist or that Terraform is asking the wrong account. “More than one matched” means the criteria do not identify one result where the provider schema expects uniqueness. A permission error means the provider identity lacks the read action even if it can perform other resource operations. An unexpected replacement downstream may mean the same dynamic query now returns a newer object.

Debug from inputs outward. Inspect the provider alias and credentials, confirm the active region or project, list the exact filters, and decide whether every argument is known during planning. Then compare those inputs with current external reality. This is more reliable than adding ordering controls to a lookup whose actual problem is context or matching.

Data sources can form lookup chains. A configuration may discover a VPC, then find its private subnets, then configure application infrastructure:

```text
data.aws_vpc.shared
        │ .id
        ▼
data.aws_subnets.private
        │ .ids
        ▼
application resources
```

References express that order without a manual sequence.

A data block can also use `count` or `for_each`:

```hcl
data "some_server" "servers" {
  for_each = toset(var.server_names)

  name = each.value
}
```

For `web`, `worker`, and `database`, Terraform creates addressed query instances:

```text
data.some_server.servers["web"]
data.some_server.servers["worker"]
data.some_server.servers["database"]
```

Consumers can select `data.some_server.servers["web"].id` or transform the complete result map. Like managed resources, data sources participate fully in Terraform's collection, addressing, expression, and dependency systems.

Multiple queries can also connect external ownership domains. A first lookup may discover a shared VPC by tags. A second uses its ID to retrieve private subnets. A third could read a DNS zone associated with the same environment. Terraform does not require those blocks to appear in execution order; the attribute references identify which result feeds which query.

Collection keys become part of query-instance identity. With `for_each`, `data.some_server.servers["web"]` and `data.some_server.servers["worker"]` remain distinguishable values. Downstream maps can preserve those semantic keys instead of relying on positional indexes. The general addressing and stability considerations used for resources therefore help make repeated lookups understandable too, even though these instances own no remote lifecycle.

![Provider context and value timing determine the path each lookup follows](/content-assets/articles/article-iac-terraform-config-data-sources/data-source-timing-paths.png)

## Why Do Data Sources Create State and Security Concerns?

Read-only does not mean stateless. Traditional data-source results participate in Terraform state so later expressions and operations can use the provider's returned values. The ownership difference is:

```text
resource
= remote object with Terraform-managed lifecycle
  + Terraform state representation

data source
= externally owned object queried through a provider
  + Terraform state representation of the result
```

The distinction is not “stored versus never stored.” It is whether this configuration owns lifecycle management.

That matters when a data source retrieves a secret value. If a secret manager returns a database password, do not assume the read-only block keeps it out of state or saved plan data. Marking a downstream expression `sensitive` controls ordinary presentation but does not inherently prevent persistence.

```text
sensitive
└── avoid casual CLI or UI display

sensitive does not automatically mean
├── encrypted
└── omitted from state
```

Treat state as sensitive infrastructure data. A production backend should provide controlled access, encryption at rest, protected transport, locking, and auditability. Do not commit `terraform.tfstate` to version control. Also review saved plans, CI logs, backups, and any systems that consume derived outputs.

Modern Terraform supports ephemeral values or resources and provider-supported write-only arguments for flows that must avoid persistence. Those are distinct features with explicit restrictions; an ordinary `data` block does not become ephemeral simply because it performs a read.

Before reading a secret, ask whether Terraform truly needs the plaintext. If it does, trace every downstream expression and state destination. A local, output, or resource argument can carry the value further. The security boundary is the whole dataflow, not the word `data` in the declaration.

The same caution applies to saved plans. A plan can contain concrete data-source results when the lookup runs during planning, including values that later feed resource arguments. Redacting a terminal view does not prove that the underlying plan file omits the content. Store and transfer plan artifacts under controls appropriate for the most sensitive value they may contain.

State also explains why a later refresh can observe an external change. Terraform can query the object again and update its representation of the data result. If downstream desired configuration changes as a result, the plan shows those consequences. The data source still does not own the external object's lifecycle; it simply imports a newer observation into the graph.

Avoid treating remote state as a secret-filtering interface. A configuration may read selected root outputs, but access to another state backend can expose broader infrastructure information. Keep state boundaries narrow, grant only required access, and prefer interfaces designed for the ownership and sensitivity of the shared value when appropriate.

## How Do You Choose the Right Source for a Value?

When a module needs a VPC ID, four designs express four ownership choices:

```hcl
vpc_id = "vpc-abc123"
```

The exact ID is fixed in configuration.

```hcl
vpc_id = var.vpc_id
```

The module caller chooses the VPC.

```hcl
vpc_id = aws_vpc.main.id
```

This configuration manages the VPC.

```hcl
vpc_id = data.aws_vpc.shared.id
```

Another owner manages the VPC, and Terraform discovers it.

A local answers a different question: Terraform already has values and the module wants to name or transform them. Choosing the construct by origin keeps ownership clear:

| Construct | Meaning |
| --- | --- |
| Variable | A caller supplies the value |
| Local | The module calculates or names the value |
| Data source | A provider discovers the value externally |
| Resource attribute | A managed object produces the value |
| Output | The module exposes the value |

Follow a complete example. A platform team owns approved AMIs, while this configuration owns application servers:

```hcl
data "aws_ami" "app" {
  most_recent = true
  owners      = ["self"]

  tags = {
    Name   = "app-server"
    Tested = "true"
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.app.id
  instance_type = "t3.micro"
}

output "instance_id" {
  value = aws_instance.web.id
}
```

Terraform reads the query constraints, and the AWS provider searches the configured account and region for the newest tested application image. Suppose it returns `ami-abc123`. That becomes `data.aws_ami.app.id`, and the reference creates the edge into `aws_instance.web`.

The plan can now show a server using `ami-abc123`. During apply, the provider creates that server and returns `i-987654`. The managed resource attribute feeds `output.instance_id`, which is then exposed outside the module.

```text
external AWS image catalog
           │ read
           ▼
data.aws_ami.app
           │ discovered AMI ID
           ▼
aws_instance.web
           │ managed instance ID
           ▼
output.instance_id
           │
           ▼
module consumer
```

![Data sources observe the external world while resources manage desired infrastructure](/content-assets/articles/article-iac-terraform-config-data-sources/data-sources-summary.png)

This is the deepest model: a data source turns external facts into Terraform values. Resources mostly carry desired Terraform values toward managed infrastructure. Together they let a graph observe what exists, calculate relationships, manage what this configuration owns, and expose results without confusing discovery with lifecycle authority.

The ownership test also prevents two opposite mistakes. Using a resource for an object another team owns may give this state destructive authority it should never have. Using a data source for an object this state is supposed to maintain leaves Terraform unable to reconcile its configuration. The syntax can look similar, but the lifecycle contract is fundamentally different.

Hard-coding and variables remain valid when deliberate. A pinned image ID can be the right choice for reproducible releases, and a VPC ID variable can be the right interface when the caller, rather than the module, should select the network. A data source is appropriate when discovery itself belongs inside the module and the query criteria express a stable relationship.

Before choosing, ask: Who owns the object? Who should select it? Should the dependency float as external reality changes? Which provider context performs the lookup? Can the result be known during planning? Could it contain sensitive information? Those questions connect value origin, lifecycle, reproducibility, timing, and security in one design decision.

Finally, remember that read-only describes the provider operation, not the total plan consequence. A newly discovered AMI, subnet set, zone ID, or account attribute can alter arguments of managed resources. Terraform may then propose updates or replacements even though the data source itself changed nothing remotely. Review dynamic results as inputs to the desired-state calculation, especially when “most recent” or broad filters can select a different object over time.

Conversely, a stable query can remove brittle copied IDs while keeping intent readable. “Use the shared production VPC with these approved tags” communicates a relationship that can survive replacement of the underlying remote identity. The value and dependency flow automatically into every consumer. That combination—external observation, explicit ownership, and graph-aware reuse—is the main strength of a well-designed data source. It keeps discovery separate from management while preserving a precise dependency, making the resulting plan easier to reason about, validate, review, operate, maintain, troubleshoot, reproduce, inspect, audit, govern, explain, verify, and secure over time.

That distinction should remain visible in every module interface and plan review.

Data lookups make external infrastructure part of the plan's input context. Their selectors should identify one stable object, and permissions must allow the provider to read it during planning. A broad name or tag query can begin returning a different object without any configuration edit, changing downstream arguments. Prefer immutable or tightly controlled identifiers where the source supports them, validate assumptions through outputs or preconditions, and remember that reading an object does not transfer its lifecycle into the current state as a managed resource.

Two inspection commands clarify the boundary. `terraform providers` shows which provider requirements and configurations the root graph depends on, including those used by data sources. `terraform output` reads declared root outputs after an apply; it is not a general data-source query command. A data source participates in expression evaluation and the plan, while an output is an explicit interface selected by the configuration author.

## Check Your Answers

:::expand[Why Does Terraform Need Data Sources?]{kind="recap"}
Configurations often need facts about networks, identities, zones, images, or other objects managed elsewhere. A data source queries that external reality and brings the result into Terraform's value graph.
:::

:::expand[How Do Resources and Data Sources Differ?]{kind="recap"}
Resources own create, update, replacement, and destroy behavior in this configuration. Data sources perform read-only discovery; use import when an existing object should become resource-managed.
:::

:::expand[How Does a Lookup Become a Terraform Value?]{kind="recap"}
A provider-defined `data` type accepts query arguments and returns attributes referenced as `data.<type>.<name>.<attribute>`. Provider documentation defines the exact schema and matching behavior.
:::

:::expand[How Do References Replace Hard-Coded Identities?]{kind="recap"}
A data reference supplies both a discovered value and a graph edge. It replaces a fixed remote ID with a relationship, but dynamic queries can introduce moving inputs that affect reproducibility.
:::

:::expand[When Does Terraform Read a Data Source?]{kind="recap"}
Known query arguments usually allow a planning-time read. Unknown arguments defer the read to apply, propagate unknown results, and may require explicit `depends_on` only for hidden dependencies.
:::

:::expand[How Do Provider Context and Multiple Lookups Shape Results?]{kind="recap"}
Results depend on filters, provider account or region, and current reality. Data sources can chain together and can create multiple addressed query instances with `count` or `for_each`.
:::

:::expand[Why Do Data Sources Create State and Security Concerns?]{kind="recap"}
Traditional data results are represented in state, including potentially sensitive values. Redaction does not prevent storage, so protect backends, plans, logs, and every downstream consumer.
:::

:::expand[How Do You Choose the Right Source for a Value?]{kind="recap"}
Choose by origin and ownership: caller input, module calculation, external discovery, managed resource result, or published output. Resources own objects; data sources import knowledge.
:::

### References

- [Query data from external sources](https://developer.hashicorp.com/terraform/language/data-sources)
- [`data` block reference](https://developer.hashicorp.com/terraform/language/block/data)
- [`depends_on` meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on)
- [Writing provider state](https://developer.hashicorp.com/terraform/plugin/framework/handling-data/writing-state)
- [Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
