---
title: "Third-Party Actions and Plugin Risk"
description: "Learn how to review, pin, permit, update, and contain third-party actions, reusable workflows, install scripts, Jenkins plugins, and shared libraries that execute inside CI/CD."
overview: "Treat every CI extension as executable supply-chain code. Compare tags with immutable commits, combine pinning with least privilege and allowlists, turn updates into reviewed changes, protect reusable workflows and Jenkins shared libraries, learn the Codecov incident's execution-chain lesson, and use a trust budget based on reach, authority, and multiplicity."
tags: ["devsecops", "pipeline-security", "github-actions", "jenkins"]
order: 4
id: article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk
---

## Table of Contents

1. [Why Is Every CI Extension Executable Supply-Chain Code?](#why-is-every-ci-extension-executable-supply-chain-code)
2. [What Do Tags and Commit Pins Actually Protect?](#what-do-tags-and-commit-pins-actually-protect)
3. [How Do Permissions, Secrets, and Allowlists Limit Blast Radius?](#how-do-permissions-secrets-and-allowlists-limit-blast-radius)
4. [How Should New Extensions and Automated Updates Be Reviewed?](#how-should-new-extensions-and-automated-updates-be-reviewed)
5. [Why Do Reusable Workflows and Shared Libraries Need Extra Protection?](#why-do-reusable-workflows-and-shared-libraries-need-extra-protection)
6. [What Do Install Scripts, Plugins, and the Codecov Incident Teach?](#what-do-install-scripts-plugins-and-the-codecov-incident-teach)
7. [How Do You Roll Updates Without Freezing Trusted Code Forever?](#how-do-you-roll-updates-without-freezing-trusted-code-forever)
8. [What Is a Practical Trust Budget for CI Dependencies?](#what-is-a-practical-trust-budget-for-ci-dependencies)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A CI runner is a computer executing a delivery recipe. When the recipe says:

```yaml
- uses: vendor/action@v3
```

the short `uses` line is a dependency declaration. It means that code controlled by another repository or publisher will execute inside the job.

That code may read the checked-out repository, environment variables, platform token, files created by earlier steps, build outputs, caches, and network. It may write later inputs, reports, artifacts, or commands. If the job can publish, sign, or deploy, the extension may be able to exercise that authority while it runs.

CI dependencies can therefore be more dangerous than many application dependencies. An application library normally receives whatever capability the application gives it at runtime. A delivery extension may run where release credentials, source from many repositories, registries, signing systems, and cloud roles meet.

```text
third-party code
      +
job authority and data
      =
possible supply-chain impact
```

Marketplace actions, Jenkins plugins, shared CI templates, installers, and package hooks all extend the trusted execution path with code maintained outside the immediate pipeline.

Keep these questions in view as you work through the lesson:

1. **Why Is Every CI Extension Executable Supply-Chain Code?**
2. **What Do Tags and Commit Pins Actually Protect?**
3. **How Do Permissions, Secrets, and Allowlists Limit Blast Radius?**
4. **How Should New Extensions and Automated Updates Be Reviewed?**
5. **Why Do Reusable Workflows and Shared Libraries Need Extra Protection?**
6. **What Do Install Scripts, Plugins, and the Codecov Incident Teach?**
7. **How Do You Roll Updates Without Freezing Trusted Code Forever?**
8. **What Is a Practical Trust Budget for CI Dependencies?**

## Why Is Every CI Extension Executable Supply-Chain Code?
<!-- section-summary: Actions, workflows, plugins, shared libraries, installers, and uploaders execute inside a runner, so their code can inherit the job's source, tokens, secrets, network, and output authority. -->

- A JavaScript, container, or composite GitHub Action.
- A reusable workflow called from another repository.
- A Jenkins plugin loaded into the controller or agents.
- A Jenkins Shared Library that contributes pipeline code.
- A shell installer downloaded during a job.
- A coverage or telemetry uploader.
- A package-manager or build plugin invoked by CI.

They are related but not identical. An action commonly executes as one step inside the caller's job. A reusable workflow can define several jobs, select runners, request permissions, consume secrets, and call more workflows. A Jenkins plugin may execute persistently inside a central service and affect many pipelines. A shared library may change behavior across every job that imports it.

The security questions remain consistent:

1. Which exact code will execute?
2. Who can change that code?
3. What authority and data will it inherit?
4. How does a change to the dependency become trusted?
5. How many repositories, runners, and releases can it affect?

Treating workflow dependencies as “just configuration” hides executable trust. They deserve inventory, ownership, review, version control, update policy, and incident response like other supply-chain components.

The point at which an extension runs affects consequence. Code used in a pull-request test may see proposed source but no secrets. The same extension in a release job may see publish permission, provenance, signing requests, or environment identity. Review must include placement, not only the extension repository.

Composite actions can call shell commands and other actions. Container actions depend on an image and its layers. JavaScript actions commonly commit a bundled distribution file that is executed directly rather than rebuilt from the visible source during the job. Verify the actual entrypoint and distributed bytes, not only the most readable source directory.

Remote services remain part of the trust path even when no remote code is downloaded. An uploader can send source-derived information to a service and accept a response that influences later steps. Decide which data leaves the runner, which service identity receives it, how availability affects the pipeline, and whether a compromised response can alter a release.

![Pipeline code is code: actions, reusable workflows, plugins, and uploaders enter a runner with access to tokens, source, artifacts, and registries](/content-assets/articles/article-devsecops-pipeline-and-runner-security-third-party-actions-plugin-risk/pipeline-code-is-code.png)

_The extension's practical privilege is determined by the job in which it runs, not by the small size of its YAML declaration._

## What Do Tags and Commit Pins Actually Protect?
<!-- section-summary: A version reference selects executable code; an immutable commit pin prevents later reference movement but does not prove the pinned code is safe or appropriately privileged. -->

A version reference answers “Which code?” Common action references include a branch, a major tag such as `v3`, a release tag such as `v3.2.1`, or a full commit SHA.

Branches and tags are friendly names, but they are references. Their owner can move them to different commits. A workflow reviewed today with `vendor/action@v3` may execute different code next month without any change in the caller repository.

That mutability can be useful. A major tag can deliver security and compatibility fixes automatically. It also means the executable dependency changes outside the caller's review path.

A full commit SHA identifies one repository state:

```yaml
- uses: vendor/action@8f4b7c2... # reviewed release
```

**SHA pinning** changes the trust model. The publisher cannot move a tag and silently change what this workflow executes. Updating the dependency now requires a visible change to the pinned identifier in the caller repository.

Pinning does not prove that the selected code is benign, that the publisher account was uncompromised when it was created, or that nested downloads are immutable. The action can run an install script that fetches a mutable executable, pull an unpinned container, load package dependencies, or call a remote service whose behavior changes.

Review the full execution chain:

```text
workflow pin
   -> action source at commit
   -> action build output or entrypoint
   -> package and container dependencies
   -> install or download scripts
   -> remote services and update channels
```

The pin fixes one link. It is still valuable because it gives the caller control over when that link changes, but every mutable nested link remains part of trust.

Verify that a pinned commit corresponds to the intended upstream release. A random immutable commit is reproducible but difficult to evaluate. Record the human-readable version or release beside the SHA, inspect release notes and source changes, and confirm the repository and publisher identity.

Immutability and privilege reduction solve different problems:

```text
SHA pinning -> prevent silent code substitution
least privilege -> limit damage if selected code is malicious
```

Use both. Perfectly pinned malicious code is still malicious. A mutable but low-authority extension may still alter outputs or exfiltrate source. No single control replaces the other.

The same rule applies beyond GitHub Actions. Pin reusable workflow refs, Jenkins Shared Library versions, container image digests, package lockfiles, and installer checksums where the mechanism supports it. Preserve a reviewed update path so immutability does not become permanent staleness.

Tags also create incident ambiguity. If an organization knows that `v3` was compromised for two hours, it must determine which commit the tag named during every affected run. A full SHA recorded in the workflow and job evidence makes exposure queries more direct. Human-readable comments can preserve the release label without surrendering immutable identity.

Pinning the caller does not stop a repository administrator or compromised action from changing external behavior such as an API response. High-authority dependencies should minimize reliance on remote mutable control and verify downloaded content. When that cannot be done, treat the service as an ongoing trusted operator and monitor its behavior and incident announcements.

Generated distribution files deserve a reproducibility question: can reviewers connect the bundled JavaScript or binary entrypoint to the reviewed source and build? A source change may be absent from the committed bundle, or a bundle may contain changes not visible in source. Upstream release practices and provenance can improve confidence, but the caller still chooses what it executes.

## How Do Permissions, Secrets, and Allowlists Limit Blast Radius?
<!-- section-summary: Job permissions, secret scoping, network and runner boundaries, and publisher allowlists constrain what approved third-party code can reach even when it is compromised. -->

An action inherits the environment of its job. If the job token can administer repository content, the action may be able to administer it. If the job has a production cloud role, the action may use that role. The `GITHUB_TOKEN` permission block is therefore a blast-radius control.

Give test and analysis jobs read-only repository access where possible:

```yaml
permissions:
  contents: read
```

A later reporting step may need one write permission, and a publishing job may need one package namespace. Do not give every extension the union of all workflow authority.

Secrets follow the same principle. A coverage uploader does not need a production database password. A test setup action does not need a signing identity. Place sensitive operations in separate jobs so earlier third-party code never receives those credentials or federated roles.

Step order is not always a strong secret boundary. Code executed earlier in the same process or machine can leave state, replace tools, or influence later commands. Separate jobs, runner trust zones, and environment-scoped identity make the transition clearer.

Network access is also privilege. An action may exfiltrate source or credentials through outbound traffic or call internal services available from a self-hosted runner. Restrict egress and private routes where the workload permits, and avoid untrusted extensions on highly connected deployment machines.

An **allowlist** limits which actions or reusable workflows repositories may call. It can restrict use to organization-owned code, verified creators, or explicitly approved repositories and versions. This reduces the number of publishers whose code can enter delivery.

An allowlist is not a safety certificate. Approved publisher accounts can be compromised, maintainers can make mistakes, ownership can change, and allowed code can fetch other dependencies. The list records an organizational trust decision and should have an owner, evidence, review date, and removal process.

Repository-level permission blocks can be overridden by broader machine authority. A self-hosted runner may expose a cloud instance profile, Docker socket, internal network, or cached credential. Review the total job environment, not only the platform token.

Combine the controls:

```text
approved publisher and repository
       +
immutable reviewed ref
       +
narrow token and secrets
       +
isolated runner and network
       +
verified outputs
       =
bounded CI dependency trust
```


_Pinning controls code identity, allowlists control publisher reach, and least privilege limits consequence._

Secret scoping should account for explicit inputs and ambient environment. Passing one named secret to an action is visible. Exporting secrets as job-wide environment variables exposes them to every step and subprocess. Prefer the narrowest supported delivery method and avoid expanding sensitive values into command lines or debug logs.

Artifacts and caches can become indirect authority. A compromised analysis action may alter a report later trusted by a gate, or poison a cache consumed by a build. Give each step write access only to expected outputs, verify structured reports before privileged consumption, and separate cache writers across trust zones.

An allowlist can operate at several levels: all marketplace actions, verified publishers, organization-owned repositories, or an exact set of paths and refs. Smaller reach improves governance but increases maintenance. Choose a level the organization can actually review and keep emergency additions visible rather than allowing a broad bypass.

Audit both allowed and used dependencies. A large allowlist defines potential trust; workflow inventory shows actual trust. Remove publishers and repositories that no live workflow requires, then review exceptional use outside the standard set.

## How Should New Extensions and Automated Updates Be Reviewed?
<!-- section-summary: Review a new CI dependency as executable vendor code, and treat every automated pin change as a security-relevant code-review event rather than a clerical version bump. -->

Before adding an extension, examine six areas.

**Identity:** Who owns the repository and publisher account? Is it the expected organization? Is the project maintained, and have ownership or namespace changes occurred?

**Execution:** Is it JavaScript, a container, composite shell, plugin, or remote installer? Which entrypoint runs? Does checked-in source match generated distribution files? Which nested dependencies or downloads execute?

**Authority:** Which platform permissions, secrets, cloud roles, runner sockets, and network paths will exist? Can the extension be moved into a lower-authority job?

**Data:** Which source, artifacts, reports, credentials, metadata, or customer-like test data can it read or upload? Where does it send telemetry?

**Mutability:** Is the caller pinned to a commit or digest? Does the extension fetch mutable content later? Who can move tags, publish packages, or alter a remote service?

**Update model:** How are security fixes released? Are releases signed or documented? Can automation open reviewed update pull requests? How quickly can the team roll back?

Review source proportionally to privilege. A small formatting action with read-only access presents less consequence than a reusable production deployment workflow. High-authority extensions deserve deeper review of maintainers, code path, dependencies, release process, and incident history.

Automated dependency tools can update action SHAs or versions by opening pull requests. This turns otherwise invisible upstream movement into an explicit change with a diff, review, checks, and approval.

An update pull request is not automatically safe because a trusted bot opened it. Inspect the old and new commits, upstream release notes, source diff, changed dependencies, required permissions, network behavior, and compatibility. Verify that the new commit still belongs to the intended upstream release.

Dependency-review tooling can show newly introduced dependencies in the caller repository, but it may not understand the entire execution tree of a third-party action. Use it as evidence, not as a complete vendor review.

Protect workflow files themselves. An attacker who can change the pinned SHA, expand permissions, add a new uploader, or move a job onto a privileged runner can alter supply-chain trust. Require accountable review for pipeline and shared automation changes.

Keep an inventory of approved extensions with owner, purpose, exact source, pin, authority, consumers, update method, and last review. Inventory supports rapid response when an upstream project announces compromise.

The review should trace transitive execution. If an action invokes `npm install`, inspect its lockfile and install hooks. If it pulls a container, record the registry and digest. If it downloads a vendor CLI, inspect version selection and integrity verification. If it calls another action, include that repository and ref. Trust rarely stops at the first `uses` line.

Check the project lifecycle. Recent maintained releases are useful evidence, not proof. Look for security advisories, response process, maintainer changes, archived status, sudden namespace transfers, and whether the publisher can still support the extension. A popular abandoned plugin can be riskier than a small well-owned internal step.

Review output semantics. Does the extension write environment variables for later steps, append to `PATH`, create executable files, publish annotations, upload artifacts, or mutate the workspace? A low-permission action can still compromise a later privileged step if its output is executed or trusted without validation.

For automated updates, require the same checks as a human change. A bot account should not bypass CODEOWNERS on workflow files. The pull request should display the old and new pin, run tests in a low-authority environment, and leave an approval record. Auto-merge may be appropriate only after the organization defines which low-risk classes can move without manual review.

## Why Do Reusable Workflows and Shared Libraries Need Extra Protection?
<!-- section-summary: Reusable workflows and shared libraries centralize multi-job logic and can affect many callers, so their refs, callers, inherited authority, maintainers, and rollout process form a larger delegation boundary. -->

A reusable workflow can define entire jobs rather than one action step. It can select runners, request permissions, call environments, consume inherited secrets, invoke other workflows, and publish or deploy. The caller may see one short line while the callee controls a broad execution graph.

Review:

- Which repositories and refs may call it?
- Which version or commit identifies the workflow?
- Which inputs influence commands, runner choice, artifact names, and environments?
- Which permissions pass from caller to callee?
- Are all secrets inherited or only named values?
- Which OIDC or cloud roles can called jobs obtain?
- Can the called workflow call another mutable dependency?

Central reuse can improve security by implementing one well-reviewed deployment path. It also increases **multiplicity**: one compromised update can affect many repositories. Protect the shared repository, require independent review, pin caller references, and roll changes through staged consumers.

Do not let callers select arbitrary production environments through an unchecked string. The shared workflow should validate allowed targets and bind external trust policy to protected context. A secure reusable workflow is not a universal deployment service callable from any branch.

Jenkins Shared Libraries create a similar boundary. Library code can define pipeline behavior and run with privileges available to Jenkins or its agents. Pin library versions or trusted branches, control who can update them, and review whether callers can choose an arbitrary ref.

Protect the default library ref. A mutable branch used by hundreds of pipelines lets one merge change all of them without caller-side diffs. A versioned release and controlled rollout make the change observable and reversible.

Jenkins plugins add another form of centralized code. Plugins may run inside the controller, extend authentication or credentials, affect agents, and influence every pipeline. More plugins mean more trusted code, update channels, dependencies, and maintenance responsibility.

Review plugin maintenance status, advisories, compatibility, publisher, permissions, dependencies, and whether core or existing functionality can replace it. Remove unused plugins rather than leaving dormant code inside the trusted controller.

Reusable workflows can create privilege inversion. A low-trust caller may invoke a centrally trusted workflow that has broader permissions than the caller should possess. The shared workflow must enforce its own admission conditions rather than assuming every configured caller is equally trusted. Validate repository, ref, environment, artifact subject, and requested operation before privileged work begins.

Secret inheritance deserves a narrow interface. “Inherit all” is convenient but makes future secrets automatically available to existing callees. Name the secrets each workflow needs, document their purpose, and keep production secrets behind protected environment authorization.

Shared libraries should separate trusted and untrusted modes where the platform supports different execution controls. Library authors can affect sandboxing, credentials, and controller behavior. Review who can approve library changes and whether one developer account can both modify the library and deploy its new default reference everywhere.

Central components need consumer mapping. When a vulnerability appears in a plugin or shared workflow, teams should quickly identify every controller, repository, job, artifact, and deployment that used the affected version. Record version identities in run logs instead of relying on the current default branch.

## What Do Install Scripts, Plugins, and the Codecov Incident Teach?
<!-- section-summary: Packaging does not define trust; any downloaded installer or uploader that executes inside CI inherits the environment, so the complete delivery chain and downstream effects must be reviewed. -->

An install command can be an action without structured packaging:

```bash
curl -sSf https://example.test/uploader.sh | bash
```

The remote server controls code that immediately executes in the job. There may be no pinned version, checksum, caller-side diff, or durable copy for later investigation. TLS protects transport to the selected server; it does not prove the server currently hosts expected code.

Prefer a versioned, integrity-verified artifact retrieved from an authenticated source. Inspect it before execution, pin a digest or checksum, and limit the surrounding job authority. If the script then downloads more mutable code, that nested behavior remains in scope.

The 2021 Codecov Bash Uploader incident illustrates the consequence. The uploader distributed from Codecov's infrastructure was modified, and CI environments that downloaded and executed it could expose variables and credentials to an attacker-controlled destination. The important lesson is broader than “do not use `curl | bash`.”

Inspect the whole execution chain:

```text
caller workflow
  -> DNS and transport
  -> remote distribution service
  -> downloaded script identity
  -> script's nested commands and downloads
  -> runner environment variables and filesystem
  -> outbound network destinations
  -> artifacts and downstream credentials
```

A script can be securely transported from a compromised server. A pinned wrapper can download an unpinned payload. A low-privilege step can become high impact if the same job exposes repository, registry, or cloud credentials. Security therefore depends on identity, authority, and environment together.

The same analysis applies to Jenkins plugins. A plugin installed in the controller can have more reach than one job-scoped action because it persists, interacts with credentials and configuration, and serves many pipelines. Plugin count is part of attack surface, not merely a feature count.

Self-hosted runners amplify dependency risk. Third-party code may access private networks, persistent workspaces, Docker sockets, local credentials, or future jobs. Use isolated ephemeral machines for untrusted dependencies and keep high-authority deployment runners deliberately small.

When an extension is compromised, investigate everything it could read and influence: tokens, environment secrets, cloud sessions, source, artifacts, caches, packages, signatures, and deployments. Rotate exposed credentials and identify downstream releases, not just replace the dependency version.

The Codecov event also demonstrates why environment variables are sensitive. CI commonly places tokens and configuration in the environment for convenience. A modified uploader running legitimately can enumerate those values and transmit them without needing a memory exploit or host escape. Limit which variables exist in the job, use short-lived tokens, and separate upload from publishing and deployment authority.

Transport and integrity controls answer different questions. HTTPS helps ensure the runner communicates with the named endpoint without ordinary network modification. A checksum or signature can identify expected content. Neither protects when the trusted publishing system itself is compromised and generates new apparently legitimate content. Caller-side immutable review and least privilege reduce that remaining risk.

Jenkins plugin compromise can require controller-level response. Determine whether credentials were readable, pipeline definitions altered, agents controlled, or authentication weakened. Upgrade or remove the plugin, but also review controller logs, issued credentials, downstream builds, and persistence. Centrality increases both reach and investigation scope.

Install scripts should be stored or logged for later examination when policy permits. If the job streams remote code directly into a shell and discards it, incident responders may be unable to prove what executed at a given time. Pinning an artifact and retaining its digest improves both prevention and forensic evidence.

## How Do You Roll Updates Without Freezing Trusted Code Forever?
<!-- section-summary: Security requires immutable reviewed versions and a regular, staged update process so teams can adopt fixes, detect behavior changes, and roll back without accepting silent upstream movement. -->

Pinning without updates creates a different risk: known vulnerabilities, unsupported APIs, and abandoned dependencies remain forever. Security needs controlled movement.

A safe update loop is:

```text
update proposed
    -> inspect identity, release notes, source and dependency changes
    -> update immutable pin in a pull request
    -> run low-authority tests
    -> canary on selected trusted consumers
    -> expand rollout
    -> monitor and retain rollback pin
```

Automate discovery and pull-request creation, not the security decision. A bot can find the new upstream commit and update the reference. Reviewers decide whether the change belongs in the trust boundary.

Roll high-multiplicity shared workflows and plugins gradually. Begin with non-production or a small consumer set, observe expected outputs, token and network behavior, then expand. A central update affecting every repository at once maximizes blast radius.

Keep the former pin and rollback method. Immutable references make rollback precise: restore the last reviewed commit rather than hoping a moving tag returns to earlier code. Preserve which releases used each dependency version so incident response can identify exposure.

Update tests should include security behavior. Confirm that new versions do not request broader permissions, introduce unexpected downloads, change artifact handling, or alter environment selection. Compare outbound traffic and logs for privileged extensions where practical.

If a dependency is abandoned or repeatedly fails review, replace or remove it. An allowlisted name should not become permanent entitlement. Reduce custom extensions when platform-native functionality can perform the same task with less code and narrower trust.

Set an update cadence based on authority and exposure. A high-authority deployment workflow should not wait a year for review, while a tiny read-only formatter may tolerate a simpler cadence. Subscribe to advisories and publisher incident channels for the dependencies whose compromise could affect releases.

Staging an update means more than confirming that the job stays green. Compare produced artifacts, reports, permissions, network destinations, and execution time. Unexpected changes can indicate a legitimate new feature or a trust expansion that needs explicit approval.

When an update adds new permissions, split the function if possible. A dependency that previously read source but now requests package write may be combining unrelated tasks. Put the new publishing behavior in a separate job or choose a tool whose authority matches the original purpose.

Emergency security updates still need evidence. Review the advisory and changed code quickly, pin the corrected commit, test the relevant path, approve through the designated expedited process, and record why the accelerated decision was necessary. Avoid switching temporarily to a mutable major tag because urgency made the normal update path inconvenient.

## What Is a Practical Trust Budget for CI Dependencies?
<!-- section-summary: Evaluate each extension through reach, authority, and multiplicity, then spend deeper review and stronger containment where those factors create the largest supply-chain consequence. -->

A useful trust budget has three dimensions.

**Reach** asks what data and systems the extension can access: source, secrets, internal network, artifacts, registries, cloud APIs, or production.

**Authority** asks which changes it can make: comment, write source, publish packages, sign artifacts, alter infrastructure, or deploy.

**Multiplicity** asks how broadly one compromise propagates: one low-risk repository, every project using a shared workflow, or a central Jenkins controller serving the organization.

An extension with low values across all three needs ordinary review. A production deployment workflow, credential plugin, or ubiquitous uploader consumes much more trust budget and deserves stronger identity verification, immutable pinning, least privilege, isolation, staged updates, and monitoring.

A practical hierarchy is:

```text
prefer no extension when a simple reviewed native step is enough
      |
prefer organization-owned, narrowly scoped shared code
      |
use well-maintained third-party code at an immutable reviewed version
      |
avoid mutable remote installers and abandoned plugins
```

Do not collapse all authority into one enormous CI job. Separate checkout and tests, reporting, package publication, signing, and deployment. An extension should appear only in the job whose capability it supports.

For each dependency, record:

```text
code identity and publisher
execution type and nested dependencies
pin or digest
job permissions, secrets, runner, and network
consuming repositories
owner and review date
update and rollback method
incident contact and replacement option
```


_A CI dependency remains trusted only through a lifecycle of explicit identity, bounded authority, reviewed change, and observable rollout._

The deepest model asks four questions before every use or update: What code will execute? What authority will it inherit? Who can change that code? How does that change become trusted? A short YAML line is acceptable only when the answers are bounded and reviewable.

The trust budget should be spent consciously. If a popular third-party action saves five lines of shell but introduces a new publisher, dependency tree, network behavior, and update process into a production job, a small native step may be easier to trust. If a complex internal deployment standard must be shared across hundreds of repositories, a centrally owned reusable workflow may reduce inconsistent local code despite its high multiplicity. The decision follows total reach and governance, not an automatic preference for internal or external code.

Periodically challenge the inventory. Ask whether the extension is still used, whether its job still needs every permission, whether the publisher and maintainers are unchanged, whether pins are current, whether nested downloads remain controlled, and whether a simpler implementation now exists. Trust that is never reevaluated becomes hidden permanent infrastructure.

During design, assume one approved dependency eventually fails. Then ask whether commit pins stop silent replacement, least privilege limits action, isolated runners protect later jobs, egress controls reduce exfiltration, immutable artifacts reveal tampering, logs identify consumers, and rollback restores the last known version. Resilience to that failure is stronger than assuming review can make compromise impossible.

## Check Your Answers

:::expand[Why Is Every CI Extension Executable Supply-Chain Code?]{kind="recap"}
Actions, workflows, plugins, libraries, installers, and uploaders execute inside delivery and may inherit the job's complete data and authority.
:::

:::expand[What Do Tags and Commit Pins Actually Protect?]{kind="recap"}
An immutable commit prevents silent reference movement, but review nested downloads, publisher identity, code safety, and privilege separately.
:::

:::expand[How Do Permissions, Secrets, and Allowlists Limit Blast Radius?]{kind="recap"}
Combine approved publishers with narrow job tokens, scoped secrets, isolated runners, restricted networks, and verified outputs.
:::

:::expand[How Should New Extensions and Automated Updates Be Reviewed?]{kind="recap"}
Review identity, execution, authority, data, mutability, and update model, and treat every automated pin change as a security code review.
:::

:::expand[Why Do Reusable Workflows and Shared Libraries Need Extra Protection?]{kind="recap"}
Central automation can define many jobs and affect many consumers, so protect refs, callers, maintainers, inherited authority, and rollout.
:::

:::expand[What Do Install Scripts, Plugins, and the Codecov Incident Teach?]{kind="recap"}
Packaging does not change the rule: inspect the entire execution and download chain and everything the code can reach in CI.
:::

:::expand[How Do You Roll Updates Without Freezing Trusted Code Forever?]{kind="recap"}
Use immutable reviewed pins with automated update proposals, staged testing, monitored rollout, exposure records, and precise rollback.
:::

:::expand[What Is a Practical Trust Budget for CI Dependencies?]{kind="recap"}
Spend the strongest review and containment on extensions with the greatest reach, authority, and multiplicity.
:::

## References

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - Recommends full-length commit pinning and least-privilege workflow design.
- [GitHub allowed actions and reusable workflows](https://docs.github.com/en/actions/how-tos/administering-github-actions/managing-custom-actions-for-your-enterprise/managing-github-actions-settings-for-a-repository) - Documents action and workflow allow policies.
- [GitHub Dependabot version updates for Actions](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuring-dependabot-version-updates) - Documents automated update pull requests for workflow dependencies.
- [GitHub reusable workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows) - Documents permissions, secrets, inputs, and nested calls.
- [Jenkins plugin management](https://www.jenkins.io/doc/book/managing/plugins/) - Describes plugin lifecycle and dependency management.
- [Jenkins Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Documents trusted and versioned shared pipeline code.
- [Codecov Bash Uploader incident](https://about.codecov.io/security-update/) - Describes the modified uploader and affected CI environment variables.
