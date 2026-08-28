---
title: "Output Values"
description: "Expose important information from your Terraform configuration so operators and scripts can use it."
overview: "Output values are the data a Terraform root module publishes after planning and applying. This article shows where outputs are declared, how they consume resource attributes, how humans and scripts read them, and how output changes appear in plans."
tags: ["outputs", "output values", "terraform", "hcl"]
order: 7
id: article-iac-terraform-values-outputs
aliases:
  - infrastructure-as-code/terraform/values/outputs.md
---

## Table of Contents

1. [What Problem Do Output Values Solve?](#what-problem-do-output-values-solve)
2. [How Does an Output Declare a Public Return Value?](#how-does-an-output-declare-a-public-return-value)
3. [How Do Root Outputs Serve People and Automation?](#how-do-root-outputs-serve-people-and-automation)
4. [How Do Child Outputs Define a Module API?](#how-do-child-outputs-define-a-module-api)
5. [How Do Outputs Carry Dependencies, Unknowns, and Plan Changes?](#how-do-outputs-carry-dependencies-unknowns-and-plan-changes)
6. [What Makes a Structured Output Contract Useful?](#what-makes-a-structured-output-contract-useful)
7. [How Are Sensitive and Ephemeral Outputs Handled?](#how-are-sensitive-and-ephemeral-outputs-handled)
8. [How Do Outputs Complete a Module's Value Flow?](#how-do-outputs-complete-a-modules-value-flow)
9. [Check Your Answers](#check-your-answers)

Suppose Terraform manages a server:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

After creation, the provider can expose its ID, private IP, public IP, ARN, and DNS name. Inside the module, expressions can already reference values such as:

```hcl
aws_instance.web.id
aws_instance.web.private_ip
aws_instance.web.public_ip
```

The problem is boundary, not existence. An operator may need the public IP, a deployment script may need an endpoint, or a parent module may need the instance ID. Those consumers are outside the module where the resource attribute lives.

An output creates an explicit path:

```hcl
output "public_ip" {
  value = aws_instance.web.public_ip
}
```

```text
managed server
      │
      ▼
resource attribute
      │
      ▼
output.public_ip
      │
──── module boundary ────
      │
      ▼
operator, script, or parent module
```

![An output deliberately carries an internal value across a module boundary](/content-assets/articles/article-iac-terraform-values-outputs/output-boundary.png)

The output does not create a public IP. The provider and remote API produce that attribute as part of the resource. The output takes an existing value in Terraform's expression graph and exposes it as part of the module interface. It is not a resource, has no cloud identity, and does not cause a separate infrastructure API operation.

Keep these questions in view as you work through the lesson:

1. **What Problem Do Output Values Solve?**
2. **How Does an Output Declare a Public Return Value?**
3. **How Do Root Outputs Serve People and Automation?**
4. **How Do Child Outputs Define a Module API?**
5. **How Do Outputs Carry Dependencies, Unknowns, and Plan Changes?**
6. **What Makes a Structured Output Contract Useful?**
7. **How Are Sensitive and Ephemeral Outputs Handled?**
8. **How Do Outputs Complete a Module's Value Flow?**

## What Problem Do Output Values Solve?

Variables and outputs therefore describe opposite directions:

```text
input variable
= value crossing into a module

output value
= value crossing out of a module
```

A function analogy makes this concrete:

```text
deploy_web_server(instance_type):
    server = create_server(instance_type)
    return {
        id         = server.id
        private_ip = server.private_ip
    }
```

Terraform can accept `var.instance_type`, create `aws_instance.web`, and expose `instance_id` and `private_ip`. The caller needs to understand the contract, not every provider resource used internally.

## How Does an Output Declare a Public Return Value?

The basic declaration is:

```hcl
output "instance_id" {
  value = aws_instance.web.id
}
```

The block label `instance_id` is the public name. The required `value` argument is an expression that produces the result. A description explains the value from the consumer's perspective:

```hcl
output "instance_id" {
  description = "ID of the application EC2 instance"
  value       = aws_instance.web.id
}
```

An output can expose any suitable Terraform expression, not only one resource attribute:

```hcl
output "application_name" {
  value = local.application_name
}

output "endpoint" {
  value = "https://${aws_lb.app.dns_name}/"
}

output "instance_ids" {
  value = aws_instance.web[*].id
}

output "application" {
  value = {
    id       = aws_instance.web.id
    hostname = aws_instance.web.public_dns
    region   = var.region
  }
}
```

Variables, locals, data-source results, resource attributes, functions, collections, and objects can all contribute to the expression. Ordinary output values are stored in state so Terraform and callers can retrieve them later.

The difference between a local and an output is architectural. A local names a value for internal use:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}"
}
```

Adding:

```hcl
output "name_prefix" {
  value = local.name_prefix
}
```

makes a new promise: consumers may depend on that value. Renaming, changing, or removing it can affect callers. Outputs should therefore be selected as a public API, not used as a list of every internal value that happens to look interesting.

An output block can also carry type information, sensitivity, ephemerality where allowed, preconditions, explicit dependencies, and deprecation metadata. Those features strengthen or constrain the public contract; the core operation remains “evaluate this expression and deliberately expose its result.”

## How Do Root Outputs Serve People and Automation?

The root module is the configuration where the Terraform operation begins. After apply, its outputs can surface deployment results to the operator:

```hcl
output "application_url" {
  value = "https://${aws_lb.app.dns_name}/"
}
```

Terraform can present:

```text
Apply complete! Resources: 5 added, 0 changed, 0 destroyed.

Outputs:

application_url = "https://app-123.eu-west-2.elb.amazonaws.com/"
```

The output tells people that this generated endpoint is an important result. They do not need to inspect raw state or browse the cloud console to discover it.

After outputs have been applied and stored, the CLI can query them:

```bash
terraform output
terraform output application_url
```

`terraform output` reads root-module output values from current state. It does not provide a general listing of every arbitrary child output. That current-state behavior matters when comparing it with a plan: the plan predicts future outputs, while the command reports the last applied outputs stored now.

Humans and programs need different representations. Ordinary terminal output favors readability. Automation should use the machine-readable form:

```bash
terraform output -json
```

which conceptually returns:

```json
{
  "application_url": {
    "sensitive": false,
    "type": "string",
    "value": "https://app.example.com/"
  },
  "instance_count": {
    "sensitive": false,
    "type": "number",
    "value": 3
  }
}
```

Scripts should parse this stable structured interface instead of scraping spacing and labels intended for people.

For one simple scalar, `-raw` removes Terraform's display formatting:

```bash
terraform output -raw application_url
```

The result is directly usable in shell composition:

```text
https://app.example.com/
```

This makes outputs a practical automation bridge. A pipeline can apply infrastructure, retrieve the application URL, and run integration tests against the exact endpoint Terraform produced. The script does not need to recreate Terraform's provider lookup logic.

Root outputs can also bridge separate configurations. A network configuration might publish `vpc_id`, and another configuration can read that root output through a `terraform_remote_state` data source:

```text
network configuration
aws_vpc.main -> output.vpc_id -> network state

application configuration
remote-state data source -> vpc_id -> application resources
```

This provides value sharing, but state access has security implications because the reader may gain access to more state data than the published outputs alone suggest. Treat the backend boundary as part of the architecture.

The distinction between normal, JSON, and raw modes is worth preserving in automation design. Normal output may include names, quotes, Terraform collection formatting, and other presentation intended for a person. `-json` retains output names, sensitivity flags, type information, and values, so a program can make explicit choices. `-raw` returns only one scalar value and is convenient when a shell command needs exactly that string.

For example:

```bash
application_url="$(terraform output -raw application_url)"
curl --fail "${application_url}/health"
```

The first command reads the applied root output from state and stores only its scalar content. The second uses the URL without parsing human formatting. If the output is a list or object, use `-json` and a JSON-aware consumer instead of trying to flatten it with shell text processing.

An automation run should also understand timing. Immediately after `terraform plan`, `terraform output` still reads the previously applied state; it does not read the speculative plan. If the plan predicts a new endpoint, the command cannot return that new endpoint until apply has produced and stored it. A saved plan shows intended future changes, while the output command is a query against current state.

This is also why outputs should be deliberately named and described. They become integration points for people and tools. A script that depends on `application_url` should not have to know which load balancer resource, DNS provider, or string expression produced it. The output's semantic promise is more stable than the implementation path behind it.

## How Do Child Outputs Define a Module API?

Child outputs are the formal way a module exposes selected internals to its parent. Consider:

```text
root/
├── main.tf
└── modules/
    └── web/
        ├── main.tf
        └── outputs.tf
```

The child manages a server in `modules/web/main.tf`:

```hcl
resource "aws_instance" "web" {
  # ...
}
```

It publishes the ID in `modules/web/outputs.tf`:

```hcl
output "instance_id" {
  value = aws_instance.web.id
}
```

The parent calls the module:

```hcl
module "web" {
  source = "./modules/web"
}
```

and consumes the output as:

```hcl
module.web.instance_id
```

The child may internally manage an instance, security group, IAM role, and log group while publishing only `instance_id` and `private_ip`. That narrow interface is encapsulation: callers rely on the module's meaning without depending on all provider-specific implementation details.

A parent can use a child output like any other Terraform value:

```hcl
resource "aws_cloudwatch_metric_alarm" "cpu" {
  # ...

  dimensions = {
    InstanceId = module.web.instance_id
  }
}
```

The reference connects both values and dependencies:

```text
child aws_instance.web
          │
          ▼
child output.instance_id
          │
          ▼
module.web.instance_id
          │
          ▼
parent alarm
```

A DNS record using `module.web.private_ip` similarly waits for the child resource to produce that address. The ordinary reference usually makes a manual `depends_on = [module.web]` unnecessary.

Output names should describe meaning rather than expose resource implementation. `application_hostname` is a more stable public concept than `aws_lb_internal_application_load_balancer_dns_name`. A future internal refactor can change the provider resource while preserving the output contract. Once consumers depend on an output, treat its name, type, semantics, and sensitivity as part of the module API.

The same design rule applies to how much structure to expose. If a caller only needs an instance ID and private address, publishing those values makes the dependency explicit. Publishing the whole provider resource gives the caller access to many attributes that may be incidental, computed differently after an upgrade, or unavailable after an internal refactor. Convenience today can create an accidental compatibility promise tomorrow.

Child outputs are also the only normal public route from a child to its parent. The parent cannot write `aws_instance.web.id` to reach a resource declared inside `module.web`; that address belongs to the child's scope. The child chooses which values become `module.web.*`. This boundary lets a module replace one server implementation with another while keeping an output such as `application_hostname` stable.

References through outputs remain normal graph edges. If a parent alarm consumes the child's instance ID, Terraform does not first “print” the output and then parse it. The value flows directly through Terraform's evaluation model. The output is a named interface node between the child graph and the parent graph, preserving type, knowledge timing, sensitivity, and dependency information.

## How Do Outputs Carry Dependencies, Unknowns, and Plan Changes?

An output reference preserves its dependency. If the provider cannot know a new server's public IP until creation, the output cannot know it either:

```text
aws_instance.web.public_ip = (known after apply)
                │
                ▼
output.public_ip           = (known after apply)
```

The output does not force early discovery. It means “expose this value whenever Terraform can determine it.” After apply, the provider returns the IP, the resource attribute becomes known, the output resolves, and the value is stored in state.

A plan can display:

```text
Changes to Outputs:

  + bucket_arn = (known after apply)
```

That is a useful prediction: the interface will gain a value, but its final content depends on a remote operation.

Outputs can also change when no resource is created, updated, or destroyed. Suppose:

```hcl
locals {
  application_url = "https://${var.hostname}/"
}

output "application_url" {
  value = local.application_url
}
```

Changing `hostname` from `old.example.com` to `new.example.com` may produce:

```text
Changes to Outputs:

  ~ application_url =
      "https://old.example.com/"
      ->
      "https://new.example.com/"
```

No cloud API operation is necessary for this calculation, but ordinary outputs live in state. Applying the plan updates the stored return value. Terraform therefore includes root-output differences in desired-state planning and can have an output-only plan.

This separates two moments:

```text
terraform plan
└── predicts what output values should become

terraform output
└── reads the output values in current stored state
```

Before apply, the predicted URL and the stored URL can legitimately differ. After apply, state reflects the new output.

Most dependencies should remain implicit through expressions. Occasionally the value is technically available before a related system is ready. An explicit dependency can represent that hidden operational relationship:

```hcl
output "private_ip" {
  value = aws_instance.web.private_ip

  depends_on = [
    aws_security_group_rule.application_access
  ]
}
```

This says not to consider the output ready until the access rule completes. Use it only for a real hidden dependency. A direct reference is clearer whenever it can express the relationship.

Unknown output values demonstrate that Terraform separates dependency knowledge from concrete data. During planning it can know that `output.bucket_arn` comes from `aws_s3_bucket.app.arn`, that the bucket must be created first, and that the final result will satisfy an expected shape, even though the provider-assigned ARN does not yet exist. `(known after apply)` is a precise statement about timing, not uncertainty about the graph.

After apply, Terraform records ordinary root outputs in state. A later configuration edit may change only an expression, such as adding an `https://` prefix or selecting a different field from an existing object. Terraform still plans the difference because the stored output is part of the configuration's state. Applying aligns that stored interface value with the current declaration even if every remote resource is already correct.

This explains a useful no-resource scenario. Add a new output that exposes an attribute of an existing managed resource. Terraform may need no provider mutation, yet the plan contains an output addition. Apply evaluates the attribute and saves the new root output so `terraform output` can retrieve it later. Removing an output similarly changes Terraform state without necessarily deleting any infrastructure.

When a plan says no changes are required, both the managed resource graph and the root output values already match configuration. Output reconciliation is therefore part of the overall desired-state result, not an afterthought printed only for convenience.

## What Makes a Structured Output Contract Useful?

Outputs can expose lists and objects rather than forcing one block per primitive. If a module manages three servers:

```hcl
resource "aws_instance" "web" {
  count = 3
  # ...
}
```

it can publish all IDs:

```hcl
output "instance_ids" {
  value = aws_instance.web[*].id
}
```

or a useful map:

```hcl
output "instances" {
  value = {
    for instance in aws_instance.web :
    instance.id => {
      private_ip = instance.private_ip
      public_ip  = instance.public_ip
    }
  }
}
```

The structure should match how consumers use the result. Avoid exposing the entire resource object merely because it is convenient:

```hcl
output "web_instance" {
  value = aws_instance.web
}
```

That broad output invites callers to depend on many attributes that were never intended to be stable. Narrow outputs such as `instance_id`, `private_ip`, or a deliberately shaped `instances` object make future internal changes safer.

Modern output blocks can declare an intended type:

```hcl
output "instance_ids" {
  type  = list(string)
  value = aws_instance.web[*].id
}
```

For an object:

```hcl
output "application" {
  type = object({
    hostname = string
    port     = number
  })

  value = {
    hostname = aws_lb.app.dns_name
    port     = 443
  }
}
```

The name communicates meaning, the description explains the promise, and the type defines its shape. Terraform can check that the expression conforms to that contract.

An output precondition can enforce an architectural requirement before publishing the value:

```hcl
output "application_url" {
  value = "https://${aws_lb.app.dns_name}/"

  precondition {
    condition     = var.enable_tls
    error_message = "Application URL cannot be exposed unless TLS is enabled."
  }
}
```

If the condition is false, Terraform fails rather than accepting an output that violates the module's stated guarantee. This makes an output more than display: it becomes a checked part of the public contract.

Designing the structure requires the same restraint as choosing which values to expose. A list is appropriate when callers care about ordered values, while a map keyed by a stable logical name can make individual results easier to select. An object groups fields that belong to one public concept. The module should choose a shape based on consumer meaning rather than mirror whatever nested object the provider happens to return.

For example, a caller may need a hostname and port as one endpoint contract:

```hcl
output "application_endpoint" {
  type = object({
    hostname = string
    port     = number
  })

  value = {
    hostname = aws_lb.app.dns_name
    port     = 443
  }
}
```

That output can remain stable even if the internal resource type changes. Exposing `aws_lb.app` directly would couple consumers to many fields and to AWS-specific implementation details. The deliberately shaped object says exactly what the module promises.

Descriptions should explain that promise at the consumer level: whether an address is private or public, whether an ID belongs to the primary object or a collection, and what the units or expected use of a number are. A type verifies shape, but it cannot explain meaning. A precondition verifies an architectural assumption, but it does not replace a clear contract.

Changing an output type or reshaping an object can break parent expressions even when Terraform can still plan the child internally. Treat those edits like public API changes. Add a new output or deprecation path when callers need migration time, and keep output names based on stable concepts rather than transient resource addresses.

A useful final review is to read the module only from its boundary. Can a caller understand the output name, description, type, sensitivity, and availability without inspecting provider resources? Does each published value have a real consumer? Are unknown values acceptable until apply, and will ordinary root results be safe in state? If those answers are clear, the output surface is doing its job: it reveals what callers need while leaving the implementation free to change.

That is a durable public return contract.

It connects value flow without exposing unnecessary implementation detail.

That separation is the purpose of outputs.

It is intentional.

## How Are Sensitive and Ephemeral Outputs Handled?

An output may contain a password, connection string, token, or another confidential value:

```hcl
output "database_password" {
  value     = random_password.database.result
  sensitive = true
}
```

Terraform redacts a sensitive output from normal CLI presentation instead of casually printing the plaintext. Sensitivity also propagates from source expressions:

```hcl
variable "database_password" {
  type      = string
  sensitive = true
}

locals {
  connection_string = "postgres://admin:${var.database_password}@db.example.com"
}

output "connection_string" {
  value     = local.connection_string
  sensitive = true
}
```

The derived string remains sensitive because the information did not become public merely by passing through a local.

![Sensitivity follows data from its source through an output](/content-assets/articles/article-iac-terraform-values-outputs/sensitive-output-flow.png)

Redaction and persistence are different controls. An ordinary sensitive output is still recorded in state:

```text
sensitive = true
└── hide from normal presentation

sensitive = true
does not mean
├── encrypted automatically
└── absent from state
```

Anyone with sufficient state access may be able to retrieve the value. In addition, `terraform output -json` and `terraform output -raw` can intentionally reveal actual sensitive output values for automation. Protect state permissions, scripts, logs, terminals, and downstream consumers accordingly. Sensitive marking reduces accidental display; it is not a hard boundary against an authorized reader.

Ephemeral outputs address persistence instead. A child module can pass a short-lived value without recording it in plan or state, subject to Terraform's allowed-flow rules:

```hcl
output "session_token" {
  value     = ephemeral.some_service.token
  sensitive = true
  ephemeral = true
}
```

The concepts can be combined because they solve different problems:

```text
sensitive = redact ordinary presentation
ephemeral = omit supported value from plan and state
```

Ephemeral output declarations are for child modules, not root modules. A normal root output is designed to be queried later:

```text
apply calculates value
        │
        ▼
state stores value
        │
        ▼
hours later
terraform output reads value
```

An ephemeral value deliberately breaks that persistence chain. It can travel through allowed temporary paths between modules during an operation, but it cannot support the ordinary promise that a root output remains retrievable from state afterwards.

Treat every retrieval path as a possible disclosure path. Normal display may show `(sensitive value)`, but a user with permission to run `terraform output -raw database_password` can ask for the plaintext intentionally. JSON mode likewise returns machine-consumable real values. A CI step that writes either form to logs defeats the display protection, and a broadly readable backend defeats it at the storage layer.

Sensitivity propagation helps prevent accidental downgrades. If an output expression contains a sensitive password, interpolating it into a connection URL does not make the URL harmless. The derived output remains sensitive because anyone who reads it can recover the secret. The module should mark the public boundary consistently and avoid exposing sensitive data when consumers do not genuinely need it.

Ephemerality has a stricter flow model because a value omitted from plan and state cannot be used in contexts that require persistence. It is appropriate for temporary child-module handoffs such as short-lived session material, not a general switch to make arbitrary root results disappear. Combining `sensitive` and `ephemeral` says both “avoid normal display” and “avoid supported persistence,” but the systems that originally issue and finally consume the token still need their own protections.

The security review should therefore ask four questions: Does the module need to output this secret at all? Will it be stored in state? Can automation deliberately retrieve and log it? If it is ephemeral, are all uses within Terraform's allowed temporary paths? Those questions are more reliable than treating the `sensitive` label as encryption.

## How Do Outputs Complete a Module's Value Flow?

Consider a reusable web module. The caller chooses environment and server type:

```hcl
variable "environment" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}
```

The module derives a name and manages servers plus a load balancer:

```hcl
locals {
  name_prefix = "payments-${var.environment}"
}

resource "aws_instance" "web" {
  count = var.environment == "prod" ? 3 : 1

  ami           = "ami-123456"
  instance_type = var.instance_type

  tags = {
    Name = "${local.name_prefix}-web-${count.index + 1}"
  }
}

resource "aws_lb" "app" {
  name = "${local.name_prefix}-lb"
  # ...
}
```

It publishes the results callers need:

```hcl
output "application_url" {
  description = "HTTPS URL of the application"
  value       = "https://${aws_lb.app.dns_name}/"
}

output "instance_ids" {
  description = "IDs of application EC2 instances"
  value       = aws_instance.web[*].id
}
```

For production, the caller supplies:

```hcl
environment   = "prod"
instance_type = "m7i.large"
```

Terraform evaluates `local.name_prefix` as `payments-prod` and creates three addressed instances. After the provider completes them, the ID expression may become:

```hcl
[
  "i-111",
  "i-222",
  "i-333",
]
```

The load balancer may return `payments-prod-lb-123.eu-west-2.elb.amazonaws.com`, which the URL expression turns into `https://payments-prod-lb-123.eu-west-2.elb.amazonaws.com/`.

The complete flow is:

```text
                    caller
          environment + instance type
                       │
                       ▼
                 input variables
                       │
                       ▼
                      module
             ┌─────────┴─────────┐
             ▼                   ▼
           locals             resources
                                  │
                         ┌────────┴────────┐
                         ▼                 ▼
                    instance IDs      LB hostname
                         │                 │
                         ▼                 ▼
                output.instance_ids  output.application_url
                         │                 │
                         └────────┬────────┘
                                  ▼
                                caller
```

![Outputs are the deliberate return values at the edge of a module](/content-assets/articles/article-iac-terraform-values-outputs/outputs-summary.png)

The inside may contain variables, locals, provider-specific resources, data sources, naming rules, and policy logic. Consumers should not automatically depend on all of it. Outputs select the values that cross the boundary. Printing after apply is one use, but the deeper purpose is interface design: an output turns an internal Terraform value into a promise to people, scripts, parent modules, or other configurations.

A concise origin model ties the constructs together:

| Construct | Meaning |
| --- | --- |
| `var.foo` | An outside caller supplied the value |
| `local.foo` | This module derived or named the value |
| `data.foo.bar` | Terraform discovered the value externally |
| `resource.foo.bar` | Managed infrastructure produced the value |
| `module.foo.bar` | A child module deliberately exposed the value |
| `output "foo"` | This module deliberately exposes the value outside |

Outputs complete the direction that variables begin: caller to module through inputs, internal calculation and infrastructure management, then module back to caller through a narrow public return value.

Follow the example once more from the perspective of knowledge timing. The production inputs are known before planning, so Terraform can calculate the name prefix, instance count, and requested instance type. The instance IDs and load-balancer hostname do not yet exist, so their resource attributes and outputs remain unknown. The plan still shows three intended instances and output values that will become available after apply.

During apply, provider operations produce the remote identities and hostname. Those concrete values travel through the output expressions. Terraform records the ordinary root outputs in state and displays them to the operator. A parent consuming the same values through child outputs receives them directly in the graph, while a later script querying root outputs reads the stored result.

Now consider a later internal refactor. The module might replace an implementation-specific load balancer resource but preserve the meaningful `application_url` output. Callers continue using the stable contract. If the module had exposed the entire original resource object or named the output after its provider address, the refactor would be more likely to break consumers. Output design therefore affects how safely module internals can evolve.

The function analogy has limits—Terraform evaluates a declarative graph and reconciles remote systems—but it accurately captures ownership of the boundary. Inputs tell callers which choices they may supply. Outputs tell them which results they may consume. Locals, data sources, resources, and provider details can remain internal unless their information is deliberately shaped into that interface.

For root modules, the same interface is visible to both people and tools. For child modules, it connects dependency graphs. For separate configurations, stored root outputs can serve as shared values through a state reader. In every case, an output is more than console text: it is an explicitly named, typed, state-aware, and potentially sensitive contract.

Outputs form an interface for people, pipelines, and parent modules, so expose only values with a clear consumer. A sensitive output can hide routine CLI display but still remains in state and can be retrieved by authorized automation; it is not encrypted merely because it is marked sensitive. Prefer stable names and types, document when a value is known only after apply, and avoid exporting entire provider objects when callers need one endpoint or identifier. Narrow outputs reduce coupling and accidental secret propagation.

Outputs become authoritative only after a successful apply updates state. A speculative plan can show a proposed output, but `terraform output` reads the latest applied root outputs from state. Automation that consumes an endpoint or identifier must therefore bind it to the state version produced by the approved apply rather than treating a preview as a completed interface change.

## Check Your Answers

:::expand[What Problem Do Output Values Solve?]{kind="recap"}
Resources and expressions produce values inside a module. Outputs deliberately make selected results available to operators, automation, parent modules, or other consumers outside that boundary.
:::

:::expand[How Does an Output Declare a Public Return Value?]{kind="recap"}
An output names a public result and evaluates a `value` expression. It creates no infrastructure; it exposes an existing Terraform value as part of the module contract.
:::

:::expand[How Do Root Outputs Serve People and Automation?]{kind="recap"}
Root outputs appear after apply and can be read from state with `terraform output`. Humans use normal display, while scripts should prefer `-json` or `-raw` as appropriate.
:::

:::expand[How Do Child Outputs Define a Module API?]{kind="recap"}
A child output exposes selected internal values as `module.<name>.<output>` for its parent. Narrow, meaning-led outputs preserve encapsulation and carry dependencies through references.
:::

:::expand[How Do Outputs Carry Dependencies, Unknowns, and Plan Changes?]{kind="recap"}
Outputs preserve the dependencies and unknown status of their expressions. Plans can predict output additions or changes, including output-only state changes with no cloud CRUD operation.
:::

:::expand[What Makes a Structured Output Contract Useful?]{kind="recap"}
Lists and purpose-built objects can be useful APIs, but exposing whole resources creates coupling. Names, descriptions, types, preconditions, and rare explicit dependencies make the contract precise.
:::

:::expand[How Are Sensitive and Ephemeral Outputs Handled?]{kind="recap"}
Sensitive outputs are redacted but ordinarily stored and intentionally retrievable. Ephemeral child outputs avoid supported plan/state persistence and cannot serve as later-queryable root outputs.
:::

:::expand[How Do Outputs Complete a Module's Value Flow?]{kind="recap"}
Inputs cross into a module, internal values and resources calculate results, and outputs carry selected results back out. They are the module's deliberate return values.
:::

### References

- [`output` block reference](https://developer.hashicorp.com/terraform/language/block/output)
- [`terraform output` command reference](https://developer.hashicorp.com/terraform/cli/commands/output)
- [Output data from Terraform](https://developer.hashicorp.com/terraform/tutorials/configuration-language/outputs)
- [Use outputs to expose module data](https://developer.hashicorp.com/terraform/language/values/outputs)
- [`terraform plan` command reference](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Apply Terraform configuration](https://developer.hashicorp.com/terraform/tutorials/cli/apply)
- [Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
