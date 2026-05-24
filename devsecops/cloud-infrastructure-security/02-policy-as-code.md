---
title: "Policy as Code"
description: "Turn repeated infrastructure review rules into CI checks that can block risky plans."
overview: "Policy as code makes security rules explicit and reviewable. This article explains plain-language rules, deny and warn behavior, policy tests, and how policies fit beside IaC scanners."
tags: ["policy", "opa", "rego", "compliance"]
order: 2
id: article-devsecops-cloud-infrastructure-security-policy-as-code
aliases:
  - policy-as-code
  - article-devsecops-cloud-infrastructure-security-policy-as-code
  - devsecops/cloud-infrastructure-security/policy-as-code.md
---

## Table of Contents

1. [The Scalability Limit of Manual Policy Auditing](#the-scalability-limit-of-manual-policy-auditing)
2. [What Is Open Policy Agent (OPA)?](#what-is-open-policy-agent-opa)
3. [The Anatomy of a Rego Policy](#the-anatomy-of-a-rego-policy)
4. [Loops and Logic in Rego](#loops-and-logic-in-rego)
5. [Designing Tiered Decisions: Deny, Warn, and Review](#designing-tiered-decisions-deny-warn-and-review)
6. [Testing Your Policy Code](#testing-your-policy-code)
7. [Integrating Policy Gates in CI/CD pipelines](#integrating-policy-gates-in-cicd-pipelines)
8. [Putting It All Together](#putting-it-all-together)

## The Scalability Limit of Manual Policy Auditing

In a rapidly growing engineering organization, security teams are responsible for enforcing compliance rules across all cloud environments. These rules are typically compiled into long static documents, spreadsheets, or internal wikis. A classic compliance rule might declare: "All databases deployed to production must have server-side encryption enabled, and must never allow public network access."

However, keeping policies on a wiki creates a severe scalability limit. Reviewers must manually read every single Terraform plan or Kubernetes manifest inside pull requests, trying to remember and verify dozens of corporate security policies. This manual process is slow, prone to human error, and highly inconsistent. If a reviewer is working under a tight deadline, they may overlook an unencrypted database, exposing the company to security risk.

**Policy as Code** solves this by converting these plain-language rules into executable, automated checks. Instead of relying on human memory, we write policy rules in a structured programming language. These rules are executed automatically inside our validation pipelines, evaluating our infrastructure code and blocking non-compliant changes before they can ever be provisioned. By automating compliance, we establish consistent, repeatable, and non-bypassable guardrails.

## What Is Open Policy Agent (OPA)?

To automate infrastructure compliance, we need a general-purpose, language-agnostic policy engine. The industry standard for this is the **Open Policy Agent (OPA)**, a CNCF graduated project. OPA is designed to decouple policy decision-making from application-specific execution logic.

In the OPA architecture, the evaluation flow is clean:
* **The Input**: Your application or pipeline sends a structured JSON document (such as a compiled Terraform plan JSON, a Kubernetes pod configuration, or an OCI manifest descriptor) to OPA.
* **The Policy**: You write policy rules in OPA's native declarative query language, called **Rego**.
* **The Evaluation**: OPA parses the input JSON, runs it through the Rego policy rules, and returns a structured JSON response containing the policy decisions (such as a list of deny messages or approval approvals).

Decoupling policy from implementation is incredibly powerful. You can write a single Rego policy to audit security groups, run the exact same policy engine to validate Kubernetes admissions, and use it again to authorize API route access. OPA does not know how to provision a database or block a network port; it simply answers the question: "Does this proposed configuration document comply with our corporate security rules?"

## The Anatomy of a Rego Policy

Rego is a declarative query language designed to make searching and evaluating complex nested JSON documents highly efficient. Unlike imperative languages (such as JavaScript or Python) which require you to write step-by-step loops and conditions, Rego is rule-based. You describe the characteristics of a policy violation, and OPA queries the input data to see if any resource matches those characteristics.

To understand Rego, let us write a custom policy that validates a Terraform plan JSON, blocking the public admin security group ingress rule we analyzed in our previous chapter:

```rego
package devpolaris.infra

default allow = false

deny contains message if {
  resource := input.resource_changes[_]
  resource.type == "aws_security_group_rule"
  resource.change.actions[_] != "delete"

  after := resource.change.after
  after.type == "ingress"
  after.from_port <= 9000
  after.to_port >= 9000
  after.cidr_blocks[_] == "0.0.0.0/0"
  after.tags.service == "devpolaris-orders-api"
  after.tags.environment == "prod"

  message := sprintf(
    "%s opens production admin port 9000 to the public internet (0.0.0.0/0)",
    [resource.address],
  )
}
```

This Rego policy module is built on five core language mechanics:
* **Package**: `package devpolaris.infra` defines the namespace of the policy, allowing other modules to import and execute it.
* **Default Scoping**: `default allow = false` establishes a safe fallback. If no rules explicitly allow the change, OPA defaults to a deny state.
* **Rule Declaration**: `deny contains message if` defines a rule that compiles a set of error messages. If every query statement inside the curly braces evaluates to true, OPA executes the block, adding your custom `message` to the active deny set.
* **Logical AND Evaluation**: In Rego, every statement inside the rule body is evaluated sequentially. The statements are implicitly joined by a logical **AND**. If even a single statement evaluates to false (for example, if the resource's environment tag is not `prod`), the rule fails, and no deny message is added.
* **String Formatting**: The `sprintf` function compiles a highly descriptive error message for the developer, referencing the exact resource address (like `module.orders_admin_access.aws_security_group_rule.this`) to make fixing the code straightforward.

## Loops and Logic in Rego

Because infrastructure configurations are highly nested (such as lists of resource changes, arrays of security group CIDRs, or lists of IAM actions), Rego utilizes a unique array iteration syntax.

The key operator is the **underscore (`_`)** or an explicit iterator variable. The expression `resource := input.resource_changes[_]` tells OPA to loop through every item inside the `resource_changes` array of the input JSON document. Similarly, the expression `after.cidr_blocks[_] == "0.0.0.0/0"` evaluates every string in the `cidr_blocks` array. If *any* item matches the comparison, the statement is true.

This query-based logic simplifies policy writing. You do not need to manage loop counters, check for array bounds, or handle null-pointer exceptions. OPA traverses the JSON document tree automatically, evaluating the logic against every matching node and compiling the results instantly.

## Designing Tiered Decisions: Deny, Warn, and Review

When designing a Policy as Code architecture, we must avoid treating all compliance violations identical. If a minor metadata mismatch (like a missing owner tag) blocks a production deployment, developers will quickly grow frustrated with the security gates, leading them to look for bypasses. We must design a tiered decision matrix:

First, consider **Deny** rules. Deny rules represent absolute, high-confidence security violations with a zero false-positive rate. A public admin port, an unencrypted database in production, or a wildcard IAM admin role are clear deny candidates. If a plan matches these rules, OPA returns a deny response, and the CI pipeline blocks the release automatically.

Second, consider **Warn** rules. Warn rules represent configuration patterns that are suspicious but may be valid under specific architectural circumstances. For example, a security group that allows a private CIDR block wider than `/24` might trigger a warning. The CI pipeline displays the warning to the developer and reviewers, but does not block the build, encouraging security awareness without stopping development velocity.

Third, consider **Require Review** rules. These rules govern changes that are valid but highly sensitive, such as an IAM policy that allows a role to assume other roles. When these rules match, OPA flags the change as requiring a manual sign-off, routing the pull request to a named security approver for audit verification.

## Testing Your Policy Code

Policies are code, and code requires tests. A bug in a security policy can lead to two dangerous outcomes: it can allow a critical vulnerability to slip into production unnoticed, or it can block safe, urgent hotfixes during a live incident. OPA provides a built-in testing framework that executes unit tests against your Rego rules:

```rego
package devpolaris.infra_test

import data.devpolaris.infra

test_denies_public_admin_ingress if {
  input := {
    "resource_changes": [{
      "address": "module.orders_admin_access.aws_security_group_rule.this",
      "type": "aws_security_group_rule",
      "change": {
        "actions": ["create"],
        "after": {
          "type": "ingress",
          "from_port": 9000,
          "to_port": 9000,
          "cidr_blocks": ["0.0.0.0/0"],
          "tags": {"service": "devpolaris-orders-api", "environment": "prod"}
        }
      }
    }]
  }

  count(infra.deny with input as input) == 1
}
```

In this unit test, we build a mock input JSON document that mimics a vulnerable Terraform plan. We then execute the policy using the `with` keyword to override OPA's input memory: `infra.deny with input as input`. Finally, we verify that the policy returns exactly one deny message.

By compiling a comprehensive suite of unit tests checking both unsafe inputs (expecting denies) and secure inputs (expecting passes), we protect our policies from logic regressions. We execute these policy tests locally and inside our CI pipelines, ensuring that the guardrails themselves remain completely trustworthy:

```bash
$ opa test policy/ -v
data.devpolaris.infra_test.test_denies_public_admin_ingress: PASS (1.3ms)
```

## Integrating Policy Gates in CI/CD pipelines

To enforce our declarative policies programmatically, we integrate OPA checks directly into our automated git workflows. The OPA engine is deployed inside our CI runner, evaluating the Terraform plan JSON compiled during the pull request pipeline.

When OPA evaluates the plan, the CI pipeline outputs a structured, helpful review note directly in the developer's pull request. If the check fails, the pipeline returns a detailed breakdown:

```text
Policy Check: FAILED
Policy Rule: no-public-production-admin-ingress
Mode: DENY (Block Merge)
Resource: module.orders_admin_access.aws_security_group_rule.this
Reason: Production admin port 9000 allows unrestricted ingress (0.0.0.0/0)
Fix Direction: Restrict cidr_blocks to corporate VPN range 10.40.20.0/24 or attach an approved break-glass exception ticket
```

This automated feedback acts as a virtual security reviewer. It prevents arguments over compliance standards by making the rules completely explicit, transparent, and executable. Because the check runs automatically on every commit, developers catch and resolve compliance violations instantly on their own branch, without requiring manual security reviews.

## Putting It All Together

Decoupling our compliance rules from manual inspection and codifying them in declarative, testable engines completes the Policy as Code protection tier. By converting wikis into executable Rego rules, utilizing OPA to evaluate compiled Terraform plan JSONs, designing tiered decision matrices, and protecting our policies with unit tests, we build a scalable, developer-friendly compliance gate.

When designing and auditing your Policy as Code architecture, ensure you maintain these five core practices:

First, write your compliance rules in plain, direct English before writing a single line of Rego. Ensuring the policy can be explained simply guarantees that the automated code remains understandable and trustworthy.

Second, decouple policy evaluation using Open Policy Agent. Run OPA as a general-purpose evaluator, feeding it structured JSON inputs from Terraform plans, Kubernetes YAML, or OCI descriptors.

Third, enforce a tiered decision matrix. Reserve blocking deny rules strictly for high-confidence security risks, utilizing warnings for suspicious patterns that need architectural context, and requiring review gates for highly sensitive operations.

Fourth, write comprehensive unit tests for all Rego rules. Treat your policy code with the same software discipline as application code, validating both blocked and allowed scenarios to prevent regressions.

Fifth, provide descriptive, actionable feedback inside your CI outputs. Ensure that when a policy gate fails, the developer receives the exact resource address, the rule name, and a clear fix direction directly in their active workflow.

## What's Next

Static IaC scanning and Policy as Code secure our infrastructure blueprints before provisioning. However, cloud environments are dynamic. We must still detect when manual console changes "drift" from our declared code, and secure our active network perimeters. In the next chapter, **Drift and Perimeter Security**, we will cover active posture sweeps, configuration drift scanners, and VPC perimeter boundaries.

---

**References**

- [Open Policy Agent Rego Language Reference](https://www.openpolicyagent.org/docs/policy-language) - Official OPA documentation on Rego syntax, logic, and built-in functions.
- [OPA Policy Testing Framework](https://www.openpolicyagent.org/docs/policy-testing) - Guide on writing unit tests, mocking inputs, and executing OPA test suites.
- [Conftest Configuration Testing](https://www.conftest.dev/) - Utility guide on scanning Terraform plans and Kubernetes manifests using OPA.
- [OWASP Secure Infrastructure and Deployment Policy](https://owasp.org/www-project-integration-standards/writeups/build_environment_security/) - OWASP recommendations on automated policy gates, compliance-as-code, and audit logging.
- [NIST SP 800-218 SSDF - Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST guidelines on enforcing security requirements programmatically and maintaining audit evidence.
