---
title: "Infrastructure as Code Security"
description: "Scan Terraform and other infrastructure code for risky configuration before cloud APIs apply it."
overview: "Infrastructure-as-code scanning reads files and plans before resources change. This article explains what scanners can see, how to review findings, and how to keep suppressions accountable."
tags: ["iac", "terraform", "scanning", "security-groups"]
order: 1
id: article-devsecops-cloud-infrastructure-security-iac-security-scanning
aliases:
  - iac-security-scanning
  - article-devsecops-cloud-infrastructure-security-iac-security-scanning
  - devsecops/cloud-infrastructure-security/iac-security-scanning.md
---

## Table of Contents

1. [The Shift-Left Paradigm for Infrastructure](#the-shift-left-paradigm-for-infrastructure)
2. [What Infrastructure as Code Scanners Can See](#what-infrastructure-as-code-scanners-can-see)
3. [File-Based Static Scanning vs. Plan-Based Scanning](#file-based-static-scanning-vs-plan-based-scanning)
4. [Evaluating the Abstract Syntax Tree (AST) in HCL](#evaluating-the-abstract-syntax-tree-ast-in-hcl)
5. [Integrating Plan Scans into CI/CD Pipelines](#integrating-plan-scans-into-cicd-pipelines)
6. [Accountability and Suppression Lifecycles](#accountability-and-suppression-lifecycles)
7. [Putting It All Together](#putting-it-all-together)

## The Shift-Left Paradigm for Infrastructure

Historically, cloud infrastructure was provisioned and modified manually by system administrators clicking through web consoles or running ad-hoc scripts. This manual model made security extremely difficult to enforce. Security teams were forced to perform reactive audits on live environments, finding misconfigurations (like open databases or unencrypted storage) only *after* they were already exposed to the public network.

The rise of Infrastructure as Code (IaC) revolutionized this process. By defining cloud resources—such as network topologies, databases, load balancers, and identity roles—in declarative code files (using tools like Terraform, CloudFormation, or OpenTofu), we treat infrastructure exactly like software. This transition enables a highly powerful security practice: the **Shift-Left Paradigm for Infrastructure**.

Shifting left means we audit the security posture of our infrastructure *before* the resources are ever provisioned in our active cloud environments. By integrating automated scanners directly into our repository workflows, we intercept security flaws in code during peer review, blocking vulnerable blueprints from ever reaching the cloud APIs.

## What Infrastructure as Code Scanners Can See

An Infrastructure as Code (IaC) scanner (like Checkov, Trivy, or KICS) is a static analysis tool that inspects your repository's infrastructure templates. Instead of compiling or executing the code, the scanner parses the file structure and matches the declared resource properties against a database of known security misconfigurations and compliance rules.

Specifically, the scanner is designed to catch five common categories of infrastructure risk:
* **Over-Scoped Firewall Rules**: Security groups or network access control lists that allow unrestricted public ingress (e.g., source `0.0.0.0/0`) on administrative ports (like SSH port 22 or RDP port 3389).
* **Unencrypted Data Storage**: Storage buckets (S3), database instances (RDS), and block storage volumes (EBS) that are configured without default server-side cryptographic encryption.
* **Public Resource Exposures**: Databases, object stores, or key-value caches that have public accessibility flags enabled, exposing them directly to the internet.
* **Orphaned Logging and Auditing**: Log groups that lack retention policies or storage buckets that have access logs disabled, breaking forensic audit trails.
* **Over-Privileged Identity Policies**: IAM roles and access control policies that rely on wildcards (like `s3:*` on `Resource: "*"`) instead of scoped actions.

The speed and consistency of static scanners are highly valuable. By scanning every code modification automatically, the tool provides immediate, programmatic evidence directly to developers and reviewers, ensuring that basic compliance mistakes never reach production.

## File-Based Static Scanning vs. Plan-Based Scanning

When implementing IaC scanning inside an engineering team, we must understand the difference between scanning raw source files and scanning compiled execution plans. Both methods serve distinct purposes in a robust pipeline.

The first method is **File-Based Static Scanning**. The scanner reads your raw, static `.tf` or `.yaml` files directly on your laptop or in a pull request. This method is incredibly fast, providing instant feedback while the developer is writing code. However, file-based scanning has a major limitation: it cannot see values hidden behind variables, module inputs, or environment-specific configurations. If a resource depends on a variable that is resolved dynamically at runtime, the static scanner must either make a guess or skip the check entirely.

The second method is **Plan-Based Scanning**. To overcome the limitations of static files, we configure our validation pipeline to compile a machine-readable **Terraform Plan JSON** file. The plan file is compiled by the Terraform engine, which resolves all variables, expands all module calls, and incorporates environment-specific parameters before outputting the exact, proposed state change:

```bash
$ terraform plan -out=tfplan
$ terraform show -json tfplan > tfplan.json
```

Plan-based scanning is highly precise. The scanner audits the resolved JSON document, inspecting the properties of the resources after all dynamic values have been compiled. While plan scanning is slower because it requires active provider credentials to compile the plan, it provides the most accurate and auditable evidence of what will actually change in your cloud environment.

## Evaluating the Abstract Syntax Tree (AST) in HCL

Under the hood, IaC scanners do not merely read your Terraform files as raw text. They compile HashiCorp Configuration Language (HCL) into an Abstract Syntax Tree (AST). The AST is a tree-like grammatical representation of your code, mapping resource blocks, arguments, modules, and attributes into logical nodes.

Using this tree, the scanner evaluates rules against the structure of your resources. Consider this standard Terraform security group rule:

```hcl
resource "aws_security_group_rule" "orders_admin_ingress" {
  type              = "ingress"
  security_group_id = aws_security_group.orders_admin.id
  from_port         = 9000
  to_port           = 9000
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "temporary admin access"
}
```

When evaluating this resource block, the scanner traverses the AST nodes:
* It matches the resource type node: `aws_security_group_rule`.
* It verifies that the `type` attribute node matches `ingress`.
* It reads the `from_port` and `to_port` nodes, mapping the port range to 9000.
* It inspects the `cidr_blocks` array node. Because the array contains the string `"0.0.0.0/0"`, the scanner flags the resource as a high-severity finding because it opens an administrative port to the public internet.

By utilizing the AST representation, the scanner can evaluate deep structural logic, such as tracing whether a resource block references a secure module or checking if a storage bucket resource has an associated encryption rule block defined elsewhere in the file.

## Integrating Plan Scans into CI/CD Pipelines

To make IaC scanning a reliable gate, we must integrate plan-based scanning directly into our automated CI/CD pipelines. This ensures that every proposed change is scanned automatically, and that pull requests cannot be merged if they violate security policies.

When a developer opens a pull request, the CI pipeline executes an automated script. It checks out the source code, initializes the Terraform providers, compiles the plan JSON, and runs the scanner (such as Checkov) against that plan:

```bash
$ checkov -f tfplan.json
```

If the scanner finds a policy violation, the CI job exits with a non-zero status code, flagging the pull request as failed and blocking the merge button. A highly readable CI scan output provides the developer with all necessary context:

```text
FAILED DPOL-NET-001: "Ensure no security groups allow ingress from 0.0.0.0/0 to admin ports"
  Resource: module.orders_admin_access.aws_security_group_rule.this
  File: infra/prod/admin.tf:12-20
  Evidence: type=ingress, from_port=9000, cidr_blocks=["0.0.0.0/0"]
  Fix: restrict source to corporate VPN range 10.40.20.0/24 or remove listener
```

This output is self-contained and actionable. It names the specific rule breached, identifies the exact file and resource address inside the code, presents the incriminating evidence, and provides a clear fix direction. By presenting this detail directly in the pull request interface, reviewers can make informed decisions without running manual checks locally.

## Accountability and Suppression Lifecycles

In practical enterprise development, static scanners will occasionally flag resources that represent deliberate and necessary security exceptions. For example, a publicApplication Load Balancer (ALB) must naturally allow unrestricted ingress on port 443 to receive public customer traffic. If the scanner flags this public rule as a high vulnerability, you cannot resolve it by closing the port. Instead, you must configure a formal **Suppression**.

A suppression is a deliberate instruction to the scanner to ignore a specific finding. To maintain strict security audit trails, we must never ignore scanner alerts silently. Instead, we must declare the suppression explicitly inside the code, documenting the compensating controls and pointing to a formal review record:

```hcl
# checkov:skip=CKV_AWS_260: public HTTPS listener is the intended customer entry point, reviewed in NET-2026-05-19-01
resource "aws_security_group_rule" "public_https" {
  type              = "ingress"
  security_group_id = aws_security_group.public_alb.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}
```

Adding this comment inline tells the scanner to bypass this specific resource block while keeping all other port checks active.

To keep these suppressions accountable, the security team must enforce a strict **Suppression Lifecycle**:
* **Compensating Controls**: Every suppression must document the active safeguards that mitigate the risk (e.g., a Web Application Firewall, access logs, or isolated network routing).
* **Decaying Exceptions**: Exceptions must be assigned an owner and an explicit expiry date (e.g., 90 days). If the exception is not reviewed and renewed, the scanner will flag the resource again at expiry, forcing the team to re-evaluate whether the risk is still necessary.
* **Audit Trails**: Maintain a centralized, searchable registry of all suppressed rules, ensuring that external compliance auditors can easily trace the authorization history of every security exception.

## Putting It All Together

Auditing our infrastructure blueprints before provisioning represents a core pillar of modern DevSecOps. By shifting security left, analyzing abstract syntax trees inside HCL templates, compiling fully resolved plan-based JSON scans, and enforcing strict, auditable suppression lifecycles, we intercept misconfigurations before they can ever reach active cloud environments.

When securing your infrastructure pipelines, ensure you maintain these five core practices:

First, automate IaC scanning across all repositories. Integrate static checkers into your Git workflows, running file-based scans locally during development and plan-based scans inside your CI pipelines to capture dynamic configurations.

Second, block pull request merges automatically on policy failures. Treat IaC scan results as mandatory status checks, requiring developers to resolve or formally suppress findings before code is merged.

Third, parse fully resolved plan JSON files inside your pipelines. Ensure that module calls, variables, and environment parameters are fully compiled before the scanner evaluates the configuration, minimizing false-negative escapes.

Fourth, enforce strict accountability for all security suppressions. Declare all skips explicitly in the code using inline comments, document active compensating controls, and assign explicit expiration dates to prevent exceptions from aging silently.

Fifth, verify your suppressions regularly during security audits. Keep a central index of all active exceptions, ensuring that stale, temporary workarounds are continuously audited and removed when the underlying architectural patterns change.

## What's Next

Static IaC scanning secures the blueprints that describe our infrastructure. However, organizations also need custom, shareable rules that enforce specific, complex corporate compliance standards programmatically. In the next chapter, **Policy as Code**, we will explore how to write declarative, custom validation policies using the Open Policy Agent (OPA) engine and the Rego language.

---

**References**

- [Checkov Static Code Analysis](https://www.checkov.io/7.Scan%20Examples/Terraform.html) - Checkov guide on scanning HCL templates and resolving plan JSONs.
- [HashiCorp Terraform Plan Internal JSON Format](https://developer.hashicorp.com/terraform/internals/json-format) - Official specification of the machine-readable plan format.
- [Aqua Security Trivy Misconfiguration Scanning](https://aquasecurity.github.io/trivy/latest/docs/scanner/misconfiguration/) - Trivy documentation on static IaC scans, KICS rules, and template evaluation.
- [OWASP Infrastructure as Code Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Infrastructure_as_Code_Security_Cheat_Sheet.html) - OWASP guidelines on shifting left, pipeline integration, and secure IaC patterns.
- [NIST SP 800-160 Systems Security Engineering](https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final) - NIST recommendations on automated verification, design audits, and secure pipeline gates.
