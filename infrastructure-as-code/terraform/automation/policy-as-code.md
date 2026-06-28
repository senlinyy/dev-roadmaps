---
title: "Policy as Code"
description: "Plan JSON, OPA, Sentinel, and tested rules block risky Terraform changes before an approved pipeline can apply them."
overview: "Policy as code is the governance gate after Terraform creates a plan and before CI/CD applies it. This article explains plan JSON, writes OPA/Rego rules for required tags and protected deletes, shows pipeline output, explains Sentinel and HCP Terraform placement, and keeps exceptions visible."
tags: ["policy as code", "opa", "sentinel", "compliance", "terraform"]
order: 3
id: article-iac-terraform-automation-policy
---

## Table of Contents

1. [The Rule Humans Keep Missing](#the-rule-humans-keep-missing)
2. [Plan JSON as the Policy Input](#plan-json-as-the-policy-input)
3. [OPA Rules for Required Tags](#opa-rules-for-required-tags)
4. [Protected Delete Blocks](#protected-delete-blocks)
5. [Policy Between Plan and Apply](#policy-between-plan-and-apply)
6. [Policy Rules Tested Like Application Code](#policy-rules-tested-like-application-code)
7. [Visible Exceptions](#visible-exceptions)
8. [Putting It All Together](#putting-it-all-together)

The testing article covered local and module checks. The CI/CD article moved those checks into a protected workflow with target context, plan artifacts, approvals, state locking, evidence, and rollback notes. Policy as code comes after that because it needs the plan produced by the workflow.

The plan has the facts policy needs: resource address, resource type, planned action, evaluated tags, account-specific values, and output changes. A policy engine reads those facts and answers governance questions before the apply step can touch production.

## The Rule Humans Keep Missing
<!-- section-summary: Policy as code turns repeatable review rules into automated checks that run against every Terraform plan. -->

Imagine the billing service opens a pull request for a new log bucket. The Terraform looks normal. The plan is long. The reviewer checks the bucket name, lifecycle settings, encryption, and account target. One small issue slips through: the bucket is missing the `managed_by = "terraform"` tag.

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "dp-billing-prod-logs"

  tags = {
    service     = "billing"
    environment = "prod"
  }
}
```

That missing tag can create real operational pain. Cost reports may lose ownership data. Cleanup jobs may skip or delete the wrong resources. Incident queries may fail to connect the bucket with the service. A reviewer can catch this, but the reviewer is already thinking about IAM, deletes, replacements, and target context.

**Policy as code** means writing organization rules as code and running them automatically. Human review still handles intent, timing, architecture, and rollback risk. Policy handles repeatable rules that should be checked the same way for every plan.

Two common policy engines appear in Terraform workflows. **Open Policy Agent**, often called OPA, uses a policy language named Rego and fits self-managed CI systems. **Sentinel** is HashiCorp's policy language for HCP Terraform and Terraform Enterprise. HCP Terraform also supports OPA policy enforcement. The engine can vary, but the workflow shape stays the same: create a plan, export structured data, run rules, and block or warn before apply.

## Plan JSON as the Policy Input
<!-- section-summary: Terraform plan JSON gives policy engines evaluated resource values and planned actions for the exact target stack. -->

Policy can inspect raw `.tf` files, but Terraform plan JSON is usually the stronger input for environment rules. A raw file may contain variables, locals, module calls, and conditional expressions. The plan has already evaluated what Terraform knows for the target stack.

![Policy Check Gate](/content-assets/articles/article-iac-terraform-automation-policy/policy-check-gate.png)

*The gate view shows policy reading the saved plan before apply, which is the point where governance still has time to stop the change.*

The CI/CD workflow creates a saved plan and exports JSON:

```bash
terraform plan -lock-timeout=5m -var-file=terraform.tfvars -out=tfplan
terraform show -json tfplan > tfplan.json
```

`terraform plan` creates the saved plan for the target stack. `-lock-timeout=5m` waits for a state lock instead of failing immediately during normal deploy overlap. `-var-file=terraform.tfvars` loads the reviewed target values. `-out=tfplan` saves the exact planned actions. `terraform show -json tfplan` converts that saved plan into JSON for policy.

The readable plan might show the missing tag like this:

```console
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "service"     = "billing"
        }
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

The JSON gives the policy engine a structured version of the same idea:

```json
{
  "address": "aws_s3_bucket.logs",
  "mode": "managed",
  "type": "aws_s3_bucket",
  "change": {
    "actions": ["create"],
    "after": {
      "bucket": "dp-billing-prod-logs",
      "tags": {
        "environment": "prod",
        "service": "billing"
      },
      "tags_all": {
        "environment": "prod",
        "service": "billing"
      }
    }
  }
}
```

Most resource policies read from `resource_changes`. Each change has an `address`, a `type`, and a `change.actions` list. The `change.after` object contains planned values Terraform knows after the change. That shape lets a policy ask direct questions such as "Which managed resources are being created?" and "Which created resources lack required tags?"

Plan JSON needs the same care as the binary plan. It can contain sensitive values even if terminal output hides them. The CI/CD workflow should restrict artifact access, use short retention, and avoid posting full JSON into public pull request comments.

## OPA Rules for Required Tags
<!-- section-summary: OPA with Rego can return clear deny messages if planned resources miss required evaluated tags. -->

OPA evaluates rules written in **Rego**. The examples here use Rego v1 syntax and import `rego.v1` explicitly so the syntax is clear. CI should pin the OPA version, print `opa version`, and update older policy repositories before v1 examples are copied into them.

A Rego policy usually lives in a `policy/` directory in the repository or in a separate platform-policy repository. The tag policy has three pieces: the required key set, the resource changes that count as create or update, and a deny message for each missing key. The complete rule below checks every managed resource being created or updated:

```rego
package terraform.tags

import rego.v1

required_tags := {"service", "environment", "managed_by"}
taggable_types := {"aws_s3_bucket", "aws_db_instance", "aws_rds_cluster"}
write_actions := {"create", "update"}

is_write_change(actions) if {
  some action in actions
  action in write_actions
}

planned_tags(change) := tags if {
  tags := change.change.after.tags_all
  tags != null
} else := tags if {
  tags := object.get(change.change.after, "tags", {})
}

deny contains msg if {
  change := input.resource_changes[_]
  change.mode == "managed"
  change.type in taggable_types
  is_write_change(change.change.actions)

  tags := planned_tags(change)
  present := {tag | some tag in required_tags; object.get(tags, tag, "") != ""}
  missing := required_tags - present
  count(missing) > 0

  msg := sprintf("%s is missing required tags: %v", [change.address, missing])
}
```

`package terraform.tags` names where the rule lives in OPA's data tree. `required_tags` is the set of tag keys the organization expects. `taggable_types` limits this teaching rule to resource types that support tags in the platform standard. Real teams usually maintain this list in policy data, expand it over time, and add exact exceptions for resources that cannot be tagged. `write_actions` covers create and update plans, and it also catches replacements because a replacement includes a create action and a delete action. The rule loops through `input.resource_changes`, keeps managed resources with a planned write action, reads the planned tag map, and calculates which required keys are missing.

The `tags_all` detail matters for the AWS provider. The resource-level `tags` argument contains tags set on that resource. The provider's `default_tags` configuration can add shared tags, and the AWS provider exposes the merged result as `tags_all` on many resources. If your organization allows provider default tags to satisfy required tags, checking `tags_all` is the right policy input. If your organization wants every resource block to set ownership tags explicitly, check `tags` instead. The example prefers `tags_all` if present and falls back to `tags` for providers or resources without `tags_all`.

The final line builds the message the developer sees. Clear messages matter because policy failures should lead to direct fixes. For the billing bucket, the output should name the resource and missing key:

```console
aws_s3_bucket.logs is missing required tags: {"managed_by"}
```

The developer can run the same check locally after creating `tfplan.json`:

```bash
opa version
opa eval --fail-defined \
  --data policy \
  --input tfplan.json \
  "data.terraform.tags.deny[_]"
```

`opa version` records the policy engine version used for the result. `--data policy` loads the Rego files from the `policy` directory. `--input tfplan.json` passes the Terraform plan JSON as `input`. The query asks for each deny message from `data.terraform.tags.deny`. `--fail-defined` makes the command exit non-zero if any deny message exists, which turns a governance problem into a failed CI step.

A healthy version line should match the pinned OPA version:

```console
Version: <repo-pinned-opa-version>
```

A typical failing result includes the expression and value:

```console
{
  "result": [
    {
      "expressions": [
        {
          "value": "aws_s3_bucket.logs is missing required tags: {\"managed_by\"}",
          "text": "data.terraform.tags.deny[_]",
          "location": {
            "row": 1,
            "col": 1
          }
        }
      ]
    }
  ]
}
```

That output is verbose, but the important part is the denial value. Many teams wrap OPA with Conftest or a small script so pull request output shows only the messages authors need.

## Protected Delete Blocks
<!-- section-summary: Action-based policy can stop high-risk deletes or replacements before Terraform calls provider APIs. -->

Tags are a good first policy because the fix is simple. The same plan JSON can also protect high-risk actions. A production database delete, for example, should require a decommission plan, backup evidence, approvals, and a scheduled window.

Terraform represents replacements as a delete and create action pair in the plan. A policy should account for both direct deletes and replacements for protected resource types.

The protected-delete policy is smaller. It lists protected resource types, finds delete actions in the plan, and returns a message for each blocked address:

```rego
package terraform.protected_deletes

import rego.v1

protected_types := {"aws_db_instance", "aws_rds_cluster"}

deny contains msg if {
  change := input.resource_changes[_]
  change.type in protected_types
  some action in change.change.actions
  action == "delete"

  msg := sprintf("%s plans a protected delete action: %v", [change.address, change.change.actions])
}
```

The policy reads the resource type and action list. If a protected database type includes `delete`, OPA returns a denial message. Terraform replacements include a delete action in the list, so a planned replacement of a database gets the same protection as an explicit destroy. The message includes the whole action list so the author can see whether the plan is a delete or a replacement.

A failure might look like this:

```console
aws_db_instance.billing plans a protected delete action: ["delete", "create"]
```

The correct response is a controlled exception or a separate decommission workflow, not a quick policy edit that weakens the rule for every future plan. The pull request should include backup status, data retention decisions, owner approval, and the rollback or recovery path.

In HCP Terraform or Terraform Enterprise, a Sentinel-style rule can express the same guardrail during the platform policy phase:

```hcl
import "tfplan/v2" as tfplan

protected_types = [
  "aws_db_instance",
  "aws_rds_cluster",
]

main = rule {
  all tfplan.resource_changes as _, change {
    change.type not in protected_types or
    "delete" not in change.change.actions
  }
}
```

The syntax changes, but the data idea stays the same. The policy inspects planned resource changes after Terraform creates a plan and before the platform allows apply.

## Policy Between Plan and Apply
<!-- section-summary: Policy belongs after the saved plan exists and before the protected apply step can execute it. -->

The CI/CD workflow now has three major phases. First, fast checks and module tests protect the authoring layer. Second, Terraform creates the target plan and exports JSON. Third, policy checks inspect that JSON before approval or apply.

The command sequence looks like this:

```bash
terraform fmt -check -recursive
terraform init -backend-config=backend.hcl
terraform validate
terraform plan -lock-timeout=5m -var-file=terraform.tfvars -out=tfplan
terraform show -json tfplan > tfplan.json
opa version
opa test policy
opa eval --fail-defined --data policy --input tfplan.json "data.terraform.tags.deny[_]"
opa eval --fail-defined --data policy --input tfplan.json "data.terraform.protected_deletes.deny[_]"
terraform apply tfplan
```

The policy steps should run before `terraform apply tfplan`. `opa test policy` protects the rules themselves before they evaluate the production plan. The first OPA eval command asks the tag policy for denial messages, and the second asks the protected-delete policy for denial messages. `--fail-defined` makes either command fail if a denial exists. For production, the apply job should depend on every policy step passing. A failed policy result should stop the workflow and keep the denial messages in the run log.

In GitHub Actions, the policy steps can sit between plan export and apply:

```yaml
      - name: Export plan JSON
        run: terraform show -json tfplan > tfplan.json

      - uses: open-policy-agent/setup-opa@v2.4.0
        with:
          version: ${{ vars.OPA_VERSION }}

      - name: Print OPA version
        run: opa version

      - name: Test policy rules
        run: opa test policy

      - name: Check required tags
        run: opa eval --fail-defined --data policy --input tfplan.json "data.terraform.tags.deny[_]"

      - name: Check protected deletes
        run: opa eval --fail-defined --data policy --input tfplan.json "data.terraform.protected_deletes.deny[_]"

      - name: Apply approved plan
        run: terraform apply tfplan
```

The production workflow should also store the policy result as evidence. A pass shows the governance gate ran. A failure shows the gate stopped a risky change before provider APIs were called. Both are useful during audits and incident reviews.

Some teams prefer Conftest because it gives friendlier command output around OPA policies:

```bash
conftest test tfplan.json --policy policy
```

`tfplan.json` is the plan input. `--policy policy` points to the Rego policy directory. A passing run may show only a summary. A failing run should show the denial messages, such as the missing `managed_by` tag or protected database delete.

Development and production can use different enforcement levels. A new rule might warn in development while teams fix existing modules. Production should block high-confidence rules that protect real users, data, security, and cost.

## Policy Rules Tested Like Application Code
<!-- section-summary: Policy rules need unit tests so future edits do not silently weaken a governance control. -->

Policy code changes over time. Tag standards change. New database resource types appear. Teams add exceptions. A rule without tests can silently weaken during a refactor.

OPA policies can have tests written in Rego. A small test can feed the policy an example plan shape and assert that the deny message appears:

```rego
package terraform.tags

import rego.v1

test_denies_missing_managed_by_on_update if {
  some msg in deny with input as {
    "resource_changes": [{
      "address": "aws_s3_bucket.logs",
      "mode": "managed",
      "type": "aws_s3_bucket",
      "change": {
        "actions": ["update"],
        "after": {
          "tags_all": {
            "service": "billing",
            "environment": "prod"
          }
        }
      }
    }]
  }

  contains(msg, "managed_by")
}
```

The test creates a tiny input with one planned bucket and no `managed_by` tag. It runs the real `deny` rule with that input and checks that one returned message mentions the missing key.

Policy tests run with:

```bash
opa test policy
```

A passing run looks quiet:

```console
PASS: 1/1
```

A failing run should point to the policy test that broke. That feedback belongs in the policy repository's CI job. A platform team rule change should update the examples that pass and fail in the same pull request.

Good policy test fixtures stay small. A full Terraform plan JSON file can be thousands of lines long, and most tests need only the fields the rule reads. Tiny fixtures keep the rule visible and reduce the chance that a provider schema change breaks unrelated tests.

## Visible Exceptions
<!-- section-summary: Exceptions should be exact, reviewed, owned, and time-bound where possible so policy bypasses stay auditable. -->

Every real platform has exceptions. A legacy bucket may miss a tag during migration. A database may have a planned decommission. A temporary public endpoint may support a controlled customer test. Hidden exceptions create the real risk.

![Policy Failure Feedback](/content-assets/articles/article-iac-terraform-automation-policy/policy-failure-feedback.png)

*The feedback loop shows how a denial should return a useful message to the pull request instead of becoming a hidden pipeline failure.*

An exception should name the resource, reason, owner, approver, and expiry date where an expiry makes sense. It should live in code or in the policy platform so the same review path sees it.

A small exception data file might look like this:

```json
{
  "tag_exceptions": {
    "aws_s3_bucket.legacy_logs": {
      "reason": "Legacy bucket is being migrated to the shared log module.",
      "expires": "2026-09-30",
      "owner": "platform"
    }
  }
}
```

The policy can load this data and skip only the exact resource address until the exception expires. Exact matching matters. An exception for `aws_s3_bucket.legacy_logs` should not skip every bucket with `legacy` in the name.

The pull request that adds an exception should include evidence. For a missing tag, the evidence may be a migration ticket and owner. For a protected delete, it should include backup status, decommission approval, customer impact, and recovery path. The exception itself joins the deployment record.

Teams should report active exceptions. A weekly or monthly report can list resource address, owner, reason, and expiry. Old exceptions should turn into normal fixes or renewed approvals, not permanent background bypasses.

Rollback notes matter here too. If a policy exception allows a risky change, the run record should explain how the team will respond if the change causes a problem. For a database decommission, that might include the backup snapshot name, restore runbook, and owner. For a temporary public endpoint, it might include the pull request that removes the exposure after the test window.

## Putting It All Together
<!-- section-summary: Policy as code makes Terraform automation block known risks consistently while humans still review the whole change. -->

The module began with local tests. CI/CD moved those checks into a protected workflow. Policy as code used the saved plan from that workflow as the governance input. Plan JSON gave OPA or Sentinel the evaluated resource values and action list. Required tag policy caught the missing `managed_by` tag. Protected delete policy guarded high-blast-radius resources. Policy tests kept the rules from weakening silently. Visible exceptions preserved the evidence trail.

![Policy Summary](/content-assets/articles/article-iac-terraform-automation-policy/policy-summary.png)

*The summary board keeps policy practical: inspect plan facts, block repeatable risks, test the rules, and make exceptions visible.*

This is where policy belongs in the Terraform release path. It runs after Terraform has enough target context to know what will change and before the apply step can call provider APIs. It gives reviewers support on repeatable rules while humans still review intent, architecture, timing, and rollback risk.

The practical production workflow is now complete: local checks, module tests, CI/CD plan, protected artifacts, policy against plan JSON, approval, state-locked apply, evidence, and rollback notes.

---

**References**

- [`terraform show -json`](https://developer.hashicorp.com/terraform/cli/commands/show)
- [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform sensitive data in state and plans](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
- [OPA Terraform tutorial](https://www.openpolicyagent.org/docs/terraform)
- [OPA policy language](https://www.openpolicyagent.org/docs/policy-language)
- [OPA CLI `eval`](https://www.openpolicyagent.org/docs/cli)
- [OPA CLI `test`](https://www.openpolicyagent.org/docs/cli)
- [OPA setup action](https://github.com/open-policy-agent/setup-opa)
- [AWS provider resource tagging](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/resource-tagging)
- [Sentinel documentation](https://developer.hashicorp.com/sentinel/docs)
- [OPA policy enforcement in HCP Terraform](https://developer.hashicorp.com/terraform/enterprise/workspaces/policy-enforcement/define-policies/opa)
