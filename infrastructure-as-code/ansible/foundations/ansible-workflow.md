---
title: "The Ansible Workflow"
description: "Learn a production Ansible workflow from intent and target validation through preview, canary, progressive rollout, verification, recovery, and evidence."
overview: "Automation increases both power and blast radius. This article treats an Ansible deployment as a state machine that progressively reduces uncertainty: prepare trusted source and dependencies, prove inventory and variables, test connection and privilege, validate and preview, run a representative canary, widen only on health, and preserve a recoverable outcome."
tags: ["ansible", "workflow", "canary", "rollout", "verification"]
order: 2
id: article-infrastructure-as-code-ansible-workflow
---

## Table of Contents

1. [Why Must the Workflow Start with Intent and Scope?](#why-must-the-workflow-start-with-intent-and-scope)
2. [How Do You Validate the Target and Execution Path?](#how-do-you-validate-the-target-and-execution-path)
3. [What Can Syntax Checks, Linting, Check Mode, and Diff Prove?](#what-can-syntax-checks-linting-check-mode-and-diff-prove)
4. [Why Should the First Real Run Be a Canary?](#why-should-the-first-real-run-be-a-canary)
5. [How Do You Widen a Rollout Without Losing Control?](#how-do-you-widen-a-rollout-without-losing-control)
6. [How Should Failure and Rollback Be Designed?](#how-should-failure-and-rollback-be-designed)
7. [How Do Git, CI, and Automation Controllers Strengthen the Workflow?](#how-do-git-ci-and-automation-controllers-strengthen-the-workflow)
8. [What Does the Complete Workflow Prove?](#what-does-the-complete-workflow-prove)
9. [Check Your Answers](#check-your-answers)

Automation increases both power and blast radius. A correct task applied to the wrong hosts is an incident; a flawed task applied gradually can be stopped; and a green Ansible recap can still hide a broken user-facing service. A production workflow must reduce uncertainty in stages rather than jumping from edited YAML to the whole fleet.

Start with the operational statement, not YAML:

```text
Change:
    deploy application version 2.4.1

Target:
    production web hosts

Invariants:
    enough healthy capacity remains
    configuration validates before restart
    secrets do not enter logs

Success:
    health endpoint passes
    load balancer reports healthy
    error rate remains within threshold

Stop:
    canary fails or monitoring crosses threshold

Recovery:
    keep failed host drained and restore prior version
```

This statement separates business intent from mechanism. It lets reviewers ask whether Ansible is the right tool, whether the target and order are correct, and which evidence should allow the rollout to widen.

Keep these questions in view as you work through the lesson:

1. **Why Must the Workflow Start with Intent and Scope?**
2. **How Do You Validate the Target and Execution Path?**
3. **What Can Syntax Checks, Linting, Check Mode, and Diff Prove?**
4. **Why Should the First Real Run Be a Canary?**
5. **How Do You Widen a Rollout Without Losing Control?**
6. **How Should Failure and Rollback Be Designed?**
7. **How Do Git, CI, and Automation Controllers Strengthen the Workflow?**
8. **What Does the Complete Workflow Prove?**

## Why Must the Workflow Start with Intent and Scope?
<!-- section-summary: Safe automation begins by defining the intended change, target class, invariants, risk, verification, and stop conditions before writing tasks. -->

The workflow has three broad phases:

```text
prepare and predict
    -> execute progressively
    -> verify and record or recover
```

Preparation begins with a clean, reviewed repository revision. Install the declared Ansible Core environment, collections, roles, and Python dependencies. Dependency code is part of the automation: changing a collection version can change module arguments or behavior without editing a playbook.

Use Git to make the proposed procedure reviewable. A useful change includes playbook or role code, inventory structure where appropriate, tests, dependency locks or requirements, and a plain explanation of the intended rollout. Do not mix unrelated refactors with a risky production deployment.

Inventory is a queryable target map. Before execution, inspect it:

```bash
ansible-inventory -i inventories/prod --graph
ansible-inventory -i inventories/prod --host web01.example.com
```

Then ask Ansible which hosts the play resolves:

```bash
ansible-playbook -i inventories/prod deploy.yml --list-hosts
```

The output should match the operational statement. A host's group membership determines which plays and variables reach it. Dynamic inventory filters and cloud tags are part of this targeting boundary.

Variables deserve the same preflight. Stable environment values should come from reviewed inventory or controlled variable sources. Run-specific release values can come from an approved job. High-precedence extra variables can override nearly everything, so record them and avoid using ad-hoc flags to supply routine production truth.

Preparation should identify the owner of every changed thing. If Ansible renders the application config but another deployment agent rewrites the same file, an idempotent play can still create a control loop. If a cloud service controls load-balancer membership, use its supported API rather than editing generated data on a host. Desired state needs one clear authority per field.

Define the rollout unit. A role change may affect web servers, workers, and scheduled-job hosts through shared includes. A collection upgrade can change several modules. The file diff is not necessarily the operational scope, so map changed source to plays, host groups, and dependent roles before selecting a canary.

Dependencies should be installed from declared versions in a clean environment:

```bash
ansible-galaxy collection install -r collections/requirements.yml
ansible-galaxy role install -r roles/requirements.yml
ansible --version
ansible-galaxy collection list
```

The command output records what the control node will execute. A floating collection range may resolve differently on two days; pin or deliberately review upgrades according to the project's dependency policy.

Inventory source selection must also be explicit. `-i inventories/prod` can combine several files and plugins under a directory. Project `ansible.cfg` may supply a default inventory. Environment variables and command flags can override it. Print the effective configuration when diagnosis requires it instead of assuming the nearest file wins.

Intent should include nonfunctional requirements. A package upgrade may be technically correct but violate an availability window. A security fix may justify a faster batch or an emergency exception. A workflow translates both the desired end state and the safe path to reach it.

Before code review is complete, ask what would make the change unreviewable: undocumented extra vars, generated inventory nobody inspected, encrypted content without visible structure, a broad `shell` block, or a role update with unknown consumers. Resolve those gaps before granting runtime authority.

## How Do You Validate the Target and Execution Path?
<!-- section-summary: Prove inventory resolution, effective variables, transport connectivity, remote runtime, and privilege escalation separately before changing systems. -->

Think of inventory as a query:

```text
play hosts pattern
    intersected with command-line limit
    evaluated against resolved inventory
    -> concrete host set
```

`--limit` narrows a run; it does not add hosts outside the play. Tags narrow tasks, not hosts. Use both deliberately and print the resolved scope.

Effective variables resolve per host. Inspect one canary:

```bash
ansible-inventory -i inventories/prod \
  --host web01.example.com
```

This reveals inventory variables, but runtime facts, registered values, role precedence, and extra variables can still affect execution. Add assertions for required inputs inside the play:

```yaml
- name: Validate deployment inputs
  ansible.builtin.assert:
    that:
      - release_version is defined
      - release_version | length > 0
      - environment == "production"
    fail_msg: "A production release version and environment are required."
```

Next prove connectivity without mutation:

```bash
ansible -i inventories/prod web \
  -m ansible.builtin.ping
```

The path is:

```text
inventory selects host
    -> address resolves
    -> network route reaches transport
    -> connection authenticates
    -> remote runtime executes module
    -> result returns to control node
```

An `UNREACHABLE` result is different from a failed module. Diagnose DNS, route, port, credentials, host key, connection plugin, or remote runtime before investigating task logic.

Privilege escalation is another boundary. A normal connection may succeed while `become` fails:

```bash
ansible -i inventories/prod web \
  -m ansible.builtin.command \
  -a 'id -u' --become
```

The expected result for root escalation is `0`. Verify the intended become method and user, and avoid giving the connection account unrestricted privilege for tasks that require only narrow elevation.

Local and delegated tasks have different execution paths. A control-node artifact check uses the runner filesystem and CI credentials. A remote task uses the managed host. A load-balancer command delegated to an admin host uses that host's tools, network, and authority. Preflight every boundary the play will cross.

Connectivity checks should use the same inventory name, connection user, proxy path, host-key policy, and credential mechanism as deployment. A manual SSH session under a different account proves only that one person can reach the host. The automation identity must prove its own path.

If the play depends on Python, package managers, or temporary disk space, verify those prerequisites on the canary. Fact gathering can reveal interpreter and OS family, but a minimal bootstrap host may need `raw` before normal modules work. Keep bootstrap automation separate and narrowly scoped because it has fewer module safeguards.

Privilege should be tested at the smallest necessary scope. A task that edits `/etc/application/config.yml` needs an identity able to write that file, not necessarily a full interactive root shell. `become_user` can target a service account for application-owned files. Central sudo policy should reflect the tasks the role actually performs.

Variable inspection must not print secrets. `ansible-inventory --host` and high verbosity can reveal values from inventory plugins or variable files. Use protected terminals and CI logs, keep secret material in Vault or a credential system, and inspect nonsecret shape or definedness rather than dumping plaintext.

Assertions can bind target facts together:

```yaml
- name: Confirm production target facts
  ansible.builtin.assert:
    that:
      - environment == "production"
      - inventory_hostname in groups['web']
      - ansible_facts.os_family in supported_os_families
    fail_msg: "Host does not match the production web deployment contract."
```

These are guardrails, not substitutes for inventory review. They make mismatches fail close to execution and create clear diagnostics.

Delegated APIs need their own authentication preflight. A runner may reach the application hosts but not the load-balancer control plane. A delegated admin host may have an expired credential. Test a read-only status command or API query before draining the first server.

Time and clock correctness can matter for certificates, OIDC tokens, package metadata, and distributed health checks. If the operation depends on them, include the prerequisite in baseline configuration or preflight rather than discovering it halfway through a restart.

## What Can Syntax Checks, Linting, Check Mode, and Diff Prove?
<!-- section-summary: Static and predictive checks catch increasingly contextual problems, but none perfectly simulates a real remote execution. -->

Validation is a ladder:

```text
YAML parses
    -> playbook syntax is valid
    -> lint rules pass
    -> inventory and variables resolve
    -> check mode predicts supported changes
    -> diff shows selected content changes
    -> real canary execution proves remote behavior
```

Run syntax checking first:

```bash
ansible-playbook -i inventories/prod deploy.yml --syntax-check
```

It catches malformed play structure and some static errors. It does not connect to hosts, evaluate every runtime branch, or prove module arguments against live systems.

Static analysis such as `ansible-lint` adds rules for task structure, module naming, command use, file modes, and common reliability issues. Pin its version and review suppressions. Linting is source evidence, not a deployment result.

Preview a representative target:

```bash
ansible-playbook -i inventories/prod deploy.yml \
  --limit web01.example.com \
  --check --diff
```

Check mode asks modules that support it what they would change. File and package modules often provide useful prediction. A command may skip, always claim change, or require custom semantics. A later task can fail in check mode if an earlier skipped task would have created a file or registered a value.

Diff mode shows before-and-after content for supported modules. It is valuable for templates and managed files. It can reveal secret values, certificates, tokens, or other confidential configuration, so disable diff or protect logs for sensitive tasks.

Check mode is not proof. Remote state can change before execution. Some provider or service behavior is visible only after mutation. Handlers may be notified based on predicted changes but not exercise the real restart. Treat the preview as another risk-reduction signal.

The output should be reviewed for target scope, expected changed tasks, surprise deletion, skipped prerequisites, and unsupported predictions. A preview reporting everything `ok` can mean the hosts are compliant or that the important command task did not simulate anything.

Syntax checking should run against the same entry playbook and inventory shape used in deployment. A role task file is not a standalone playbook and may not validate meaningfully by itself. Import it through a small test play so variables, handlers, and role metadata participate.

Lint findings should be understood rather than silenced mechanically. A warning about `command-instead-of-module` may reveal missing idempotency. In another case, the command is the only correct interface and should gain `changed_when`, `failed_when`, and a narrow documented suppression. The point is an explicit contract.

Check mode can be controlled per task. `check_mode: false` forces a real action even during a preview and should be rare because it violates operator expectations. `check_mode: true` can force a read-only probe to run in both modes. Task authors must document deviations and ensure preview does not mutate production unintentionally.

Registered data can differ in check mode. A skipped command may not populate `stdout`, causing a later `when` or template to fail. Guard downstream use with definedness checks or provide a prediction path. Do not add dummy data that makes the preview look successful while hiding a real dependency.

Diff review should focus on semantic change. A template that reorders lines on every run can create noisy diffs and restart services even when behavior is equivalent. Stabilize iteration order, whitespace, timestamps, and generated comments so repeated rendering is deterministic.

Static checks can validate YAML schema, role argument specifications, duplicate keys, fully qualified collection names, and risky file permissions. Tests can render templates with representative variables and run configuration validators inside disposable environments. These checks are stronger than syntax alone and cheaper than touching production.

Preview also has a target-time limitation. Package repositories, inventory membership, secret versions, and host state may change between check and apply. Keep the interval short and repeat critical preflight immediately before mutation. A saved Ansible preview is not an executable transaction in the way a Terraform saved plan is.

The validation ladder should fail fast. Do not acquire a production Vault credential before a syntax check that needs no secret. Do not connect to every host before validating the canary's variable contract. Order checks so each stage receives only the authority and cost required for its claim.

## Why Should the First Real Run Be a Canary?
<!-- section-summary: A representative single-host execution reveals real connection, privilege, module, service, and environment behavior before the fleet shares the risk. -->

The first mutation should usually be narrow:

```bash
ansible-playbook -i inventories/prod deploy.yml \
  --limit web01.example.com
```

A canary limits blast radius while exercising facts a preview cannot prove: actual package repositories, file validation, service restart, runtime dependencies, load-balancer behavior, and application health.

Choose a representative host. It should use the normal production architecture, receive the same variables, have enough traffic or test coverage to expose defects, and not be a forgotten special case that always succeeds. A canary can be designated in inventory or selected from the normal group by the release process.

Read results precisely:

```text
ok
    task succeeded and reported no state change

changed
    task succeeded and reported a remote modification

failed
    module ran but task failure semantics were met

unreachable
    Ansible could not establish the execution path

skipped
    a condition or control omitted the task
```

`changed` should mean something useful. A read-only version command should set `changed_when: false`. A command that updates only when its tool prints `updated` should define that signal. Accurate change reporting makes handlers and rollout evidence trustworthy.

Verify the service, not only the playbook. Local checks can validate configuration and query a local health endpoint:

```yaml
- name: Wait for local application health
  ansible.builtin.uri:
    url: http://127.0.0.1:8080/health
    status_code: 200
    return_content: true
  register: health_result
  retries: 12
  delay: 5
  until: health_result.status == 200
  changed_when: false
```

Local health may still miss DNS, routing, TLS, load-balancer registration, or dependency behavior seen by users. Add checks from the appropriate external boundary and observe application monitoring before widening.

The canary is a decision point, not a ceremonial first host. If it fails, stop expansion, preserve evidence, and recover or investigate. Do not continue merely because the failure looks “probably host-specific” without proving that classification.

A representative canary is not always the first inventory host. Select one with typical operating-system version, network path, dependency set, and traffic profile. If the fleet deliberately contains several classes, each class may need a canary before its batch begins.

Canary preparation includes capacity. Drain the host and confirm the remaining fleet can carry load. If removing one target causes saturation, the rollout lacks safe headroom even before the new version is tested. Capacity evidence belongs before mutation.

Handlers can delay the moment of truth. A template task may report changed while its restart handler waits until the end of the play. If health checks must observe the restarted service before continuing, flush handlers at an intentional point:

```yaml
- name: Apply queued service restart now
  ansible.builtin.meta: flush_handlers
```

Use this with care because handler failures now occur earlier and because all handlers notified so far may run.

The canary's second run is valuable. After a successful deployment and health check, rerun the same play against that host. Expected configuration tasks should become `ok`, and disruptive handlers should not fire. Continued change indicates unstable desired state, timestamps, nondeterministic templates, or commands with inaccurate reporting.

Verify the actual deployed version, not just service process status:

```yaml
- name: Read deployed version
  ansible.builtin.command: application --version
  register: deployed_version
  changed_when: false
  failed_when: release_version not in deployed_version.stdout
```

Then verify a user path from outside the host. The local process can be healthy while load-balancer routing, firewall rules, TLS, service discovery, or upstream dependencies fail.

Observation needs enough time to catch delayed failure. A memory leak or queue backlog may not appear in the first successful request. Define a canary observation window proportional to the risk and normal traffic, then make the continue decision explicit.

Keep the canary identity and output in the deployment record. If later batches fail, compare their facts, variables, and results with the known-good host. This makes “host-specific” a testable hypothesis rather than intuition.

## How Do You Widen a Rollout Without Losing Control?
<!-- section-summary: Progressive batches, capacity-aware sequencing, health gates, and explicit stop rules keep one good canary from becoming an uncontrolled fleet change. -->

After a healthy canary, widen gradually:

```text
one canary
    -> small batch
    -> larger batch
    -> remaining fleet
    -> final fleet verification
```

`serial` expresses batching in the play:

```yaml
- name: Roll web hosts
  hosts: web
  serial:
    - 1
    - 2
    - "50%"
    - "100%"
```

The exact list should match fleet size and required healthy capacity. A percentage is rounded according to Ansible's batch behavior and should be tested against the real host count.

For a load-balanced service, the per-host sequence may be:

```text
drain current host
    -> wait for traffic to leave
    -> install and configure
    -> restart or reload
    -> verify local health
    -> restore to load balancer
    -> verify external health
```

Delegation can send drain and enable operations to a load-balancer admin host while application tasks run on the current managed host. The task location determines credentials and network reachability, so make it explicit.

Errors should stop expansion. `any_errors_fatal`, `max_fail_percentage`, block failure, and pipeline gates can define stop behavior. A threshold must be chosen with fleet capacity in mind: allowing ten percent failure is not safe if the service cannot handle that loss during peak traffic.

Limits can stage separate runs:

```bash
ansible-playbook -i inventories/prod deploy.yml \
  --limit web01.example.com

ansible-playbook -i inventories/prod deploy.yml \
  --limit 'web:!web01.example.com'
```

This is clear for manual or pipeline gates, while `serial` keeps batching encoded in the play. They can be combined, but record the exact resolved host set for each stage.

Application monitoring can decide whether to continue. Error rate, latency, saturation, queue depth, and business signals should be compared with pre-release baselines. Ansible can query some signals, or the automation platform can pause between batches for an external gate.

`serial` changes the set of hosts active in one batch. Tasks marked `run_once` can run once per batch rather than once for the whole play in some designs, which surprises authors using them for global migrations or notifications. Put truly global work in a separate play on localhost or an explicit control host.

Batch math should be evaluated before deployment. For six hosts, a canary plus batches of two leaves five hosts available during each update if one host is drained at a time. For two hosts, a 50 percent batch may remove half the service. Express the availability invariant in host counts and capacity, not only percentages.

Use `throttle` when one expensive task must have lower concurrency than the rest of the play. For example, package downloads may be safe in parallel while a database maintenance command must run on one host at a time. The narrow control preserves overall efficiency without weakening the risky boundary.

Failure thresholds have rounding behavior. Test `max_fail_percentage` against the actual batch sizes and prefer a stricter stop when uncertainty is high. A threshold permits failures; it does not recover failed hosts or remove them from service automatically.

Load-balancer draining should be verified. A successful disable command may only accept the request, while active connections remain. Poll target state or wait for a domain-specific drain signal before restarting. After enable, wait for the controller to report healthy rather than assuming registration is immediate.

Batch verification should include every changed host and the fleet. One host may be healthy while aggregate latency rises because fewer targets are serving during warm-up. A continue gate combines per-host readiness with global service capacity.

Avoid using `--forks 1` as an undocumented rollout policy. It limits concurrency but does not encode batches, health gates, or load-balancer sequencing. `serial` and explicit tasks communicate the deployment contract in source.

Tags can create a multi-stage procedure such as `preflight`, `deploy`, and `verify`, but a later tagged run may omit required earlier state. If stages are independently invokable, assert their prerequisites and document the transition each one expects.

Progressive rollout ends only after final verification across all intended hosts. Compare the resolved host list with successful recap entries, query deployed versions, ensure no target remains drained, and confirm monitoring has returned to normal.

## How Should Failure and Rollback Be Designed?
<!-- section-summary: Recovery is planned before deployment, distinguishes service rollback from data recovery, and treats each run as a non-transactional state transition. -->

Design stop behavior before the change:

```text
What stops the current host?
What stops the current batch?
What prevents the next batch?
Does a failed host remain drained?
Who decides to resume?
Which evidence must be preserved?
```

Rollback also starts before deployment. Keep the previous artifact or package version available, know which configuration commit restores compatibility, and ensure the rollback path is itself tested and idempotent.

Not every change can be reversed by running old YAML. Deleting data, applying an incompatible database migration, rotating a key, or changing an external protocol may require backup restoration or a forward fix. Deployment rollback and data rollback are different procedures.

Ansible blocks can encode local recovery:

```yaml
- name: Update one host with recovery
  block:
    - name: Drain host
      ansible.builtin.command: "lbctl disable {{ inventory_hostname }}"
      delegate_to: lb-admin.example.com

    - name: Deploy release
      ansible.builtin.include_role:
        name: application

    - name: Verify release
      ansible.builtin.uri:
        url: http://127.0.0.1:8080/health
        status_code: 200

  rescue:
    - name: Keep failed host disabled
      ansible.builtin.command: "lbctl disable {{ inventory_hostname }}"
      delegate_to: lb-admin.example.com
```

`rescue` reacts to a task failure in the block. It is not automatic transaction rollback. Tasks that already changed remote state remain changed unless recovery explicitly restores them.

Idempotency matters throughout recovery. Rerunning after a partial failure should safely converge completed and incomplete hosts. Accurate `changed_when`, state-aware modules, versioned artifacts, and stable inventory identities help Ansible resume from reality.

The workflow is a state machine:

```text
prepared -> validated -> previewed -> canary running
    -> canary healthy -> batch rollout -> verified
    -> or failed -> stopped -> recovered/reconciled
```

Git reversion changes desired automation source; it does not by itself change live systems. A rollback still needs an authorized run against the right targets, followed by verification.

Recovery choices depend on failure timing. If validation fails before mutation, fix source or inputs and no rollback is needed. If draining succeeds but deployment fails, keep the host out of traffic while restoring it. If the host returns healthy but global monitoring degrades, reverse traffic or version across the affected batch. If data was changed, invoke the separate data-recovery plan.

Blocks can include `always` tasks for evidence or cleanup that should run whether the block succeeds or enters rescue:

```yaml
always:
  - name: Record host rollout status
    ansible.builtin.debug:
      msg: "Completed rollout handling for {{ inventory_hostname }}"
```

Do not put an unsafe unconditional re-enable in `always`; a failed host may need to stay drained. Cleanup semantics should follow service state.

Ansible failure scope is configurable. By default, a task failure removes that host from later tasks while other hosts may continue. `any_errors_fatal` stops all hosts after the current coordination point. Decide which behavior preserves capacity and consistency for this play rather than relying on defaults.

Unreachable hosts may be handled differently from module failures. A host that never received the change does not need the same rollback as one that failed after replacing configuration. The evidence should record how far each host progressed.

Rollback artifacts must remain compatible with current data and dependencies. Keeping an old package file is insufficient if a database migration removed the schema it expects. Expand-and-contract application changes allow old and new versions to coexist during the rollback window.

Idempotency makes forward repair possible. If three of ten hosts completed, correct the role and rerun it: compliant hosts remain stable, partially changed hosts converge, and untouched hosts receive the corrected procedure. This is often safer than trying to replay inverse commands.

Recovery ends with reconciliation. Source, inventory, variable data, and automation-controller configuration should describe the live recovered state. Emergency manual actions need a follow-up commit or run so the next ordinary play does not reintroduce the incident.

Practice rollback in a disposable or staging environment. A recovery path used only in documents will likely contain missing artifacts, credentials, or assumptions when production fails. Test failure injection and confirm that expansion stops.

## How Do Git, CI, and Automation Controllers Strengthen the Workflow?
<!-- section-summary: Version control and controlled execution separate review and validation from credentialed deployment while preserving reproducible evidence. -->

Git records the playbook, roles, inventory structure, dependency declarations, and change explanation. Pull requests create a place to review target logic, idempotency, handlers, failure behavior, and verification before production authority is available.

CI can run a validation phase without production mutation:

```text
clean checkout
    -> install pinned dependencies
    -> YAML and syntax checks
    -> ansible-lint
    -> role and playbook tests
    -> inventory checks
    -> check mode against safe targets where appropriate
```

Deployment is a separate protected phase with inventory access, Vault identities, SSH or platform credentials, approval, concurrency controls, and audit retention. The validation job should not receive all production secrets merely because it parses the same files.

An automation platform formalizes the control node. It can define inventories, execution environments, credentials, job templates, surveys, approvals, schedules, role-based access, and run history. It does not remove the need for safe playbooks; it makes execution context more consistent and governable.

Think of the platform as a controlled control node:

```text
reviewed project revision
    + pinned execution environment
    + approved inventory
    + scoped credentials
    + job parameters
    + authorized operator or workflow
    -> one recorded Ansible run
```

Extra variables are powerful and dangerous in job forms. Allow only intended deployment inputs, validate them, and prevent arbitrary extra vars from overriding privilege, hosts, or security controls. Secrets need credential stores or Vault identities, not free-text survey fields.

Test roles and playbooks at several levels. Syntax and lint are cheap. Unit-like role tests can verify rendered files and idempotency on disposable systems. The second run matters: unnecessary changes reveal unstable tasks. Production still needs a canary because test environments cannot reproduce every dependency and traffic condition.

Observability belongs in the workflow. Preserve the repository revision, dependency versions, inventory source, resolved hosts, limits, tags, extra variables, credential identity, task results, timing, approvals, health evidence, and final disposition. Redact secrets without erasing the information needed to reconstruct failure.

Human and automated workflows have different interaction models. A human can pause, inspect a host, and decide. CI needs encoded timeouts, retry limits, approval gates, and escalation. Convert every necessary human intuition into either a machine check or an explicit decision point.

An automation controller can separate project sync from job execution. It fetches an approved Git revision, builds or selects an execution environment, resolves inventory, injects credentials, and runs a template. Pin the revision used by a production job so a branch update during approval cannot silently change the playbook.

Credentials should be attached to the narrow job template and inventory, not embedded in source. Separate machine credentials, Vault identities, cloud inventory credentials, and delegated API credentials. A user may have permission to launch a template without being able to read the secret material it uses.

Concurrency belongs in the controller too. Two deployment jobs against the same fleet can interleave even if Ansible itself behaves correctly. Use workflow locks, schedules, or job slicing rules so one rollout owns the relevant service boundary at a time.

CI validation can use Molecule or other disposable test environments for roles. A scenario creates a target, applies the role, verifies expected state, applies again for idempotency, and destroys the target. This is useful evidence, not a substitute for the production canary and its external dependencies.

Git history should connect source to outcome. Tag or record the deployed commit, link the job to the pull request and release, and make a rollback job select an explicit earlier version rather than whatever the branch currently contains.

Automation logs need retention and access policy. Verbose output can expose commands, paths, inventory, and possibly secrets. Preserve structured evidence under restricted access, use `no_log` narrowly, and avoid turning off all diagnostics for an entire role.

The pipeline should also record skipped hosts and tasks. A “successful” job that matched zero hosts or skipped the deployment condition is not evidence of rollout. Assert nonempty target scope and expected participation.

## What Does the Complete Workflow Prove?
<!-- section-summary: Each phase proves one bounded claim and either reduces uncertainty enough to continue or stops before wider exposure. -->

A complete end-to-end workflow is:

**1. Source preparation.** Define intent, review code, and build a clean pinned execution environment.

**2. Target validation.** Resolve inventory, host patterns, limits, groups, and effective environment data.

**3. Connectivity.** Prove connection, remote runtime, delegation paths, and privilege separately.

**4. Static validation.** Run YAML, syntax, lint, and focused role tests.

**5. Prediction.** Use check and diff mode for supported tasks, review expected changes, and protect sensitive output.

**6. Canary.** Mutate one representative host, read structured results, and verify service health from the right boundary.

**7. Progressive rollout.** Widen through capacity-aware batches with stop thresholds and monitoring gates.

**8. Final verification.** Confirm all intended hosts, fleet health, version convergence, and user-facing behavior.

**9. Record outcome.** Preserve target, inputs, versions, results, approvals, health evidence, failures, recovery, and any remaining drift.

The run order is:

```text
intent
  -> source and dependencies
  -> inventory and variables
  -> connectivity and privilege
  -> syntax, lint, tests
  -> check and diff
  -> canary
  -> service verification
  -> batches with monitoring
  -> final verification
  -> evidence
```

At any stage, failure should stop the claims that depend on it. A syntax failure blocks preview. An unreachable canary blocks mutation. A healthy task recap with a failed external health check blocks rollout. A threshold breach triggers recovery rather than the next batch.

The four feedback loops are:

```text
development
    edit -> lint/test -> revise

pre-deployment
    resolve target -> preview -> review

rollout
    canary/batch -> health -> continue or stop

recovery
    contain -> restore or repair -> verify -> reconcile source
```

Common mistakes are jumping from YAML to the fleet, treating `--check` as a perfect simulation, stopping verification at the recap, assuming a Git revert rolls back live state, and testing only the happy path.

The deepest and most durable production principle is progressive, evidence-led operational uncertainty reduction. Each phase spends a little more authority and exposes a little more of the fleet only after cheaper evidence passes. The workflow succeeds not when Ansible merely finishes, but when the intended targets reach the intended condition, the service remains acceptable, failures stop safely, and another operator can reconstruct the decision.

Each stage has a bounded proposition:

| Stage | Proposition |
|---|---|
| Source preparation | The intended procedure and dependencies are reviewable and reproducible |
| Inventory validation | The resolved targets and stable environment data match the change scope |
| Connectivity | The automation identity can reach and execute on each boundary |
| Privilege | Required elevation works without silently broadening authority |
| Static checks | Source follows known syntax and reliability rules |
| Check and diff | Supported modules predict the expected changes on this target |
| Canary | Real mutation works on one representative production host |
| Health gate | The changed host and service meet operational acceptance criteria |
| Batches | The same evidence continues while exposure and capacity change |
| Final verification | Every intended host and the user-facing system reached the accepted state |
| Evidence | The decision, execution, and recovery can be reconstructed |

The stages should not borrow certainty from one another. A lint pass says nothing about production credentials. Successful SSH says nothing about application health. A health endpoint says nothing about whether every intended host was selected. Preserving these boundaries prevents a weak signal from authorizing a strong action.

The development loop should be quick enough that authors use it constantly. The pre-deployment loop should reveal target and prediction before approval. The rollout loop should alternate mutation and observation. The recovery loop should prioritize user safety, then reconcile automation truth.

Testing only the happy path leaves the most important transitions unexamined. Test unreachable hosts, failed validation, handler failure, health timeout, load-balancer rejection, an expired secret, and cleanup failure in a safe environment. Confirm that the next batch does not begin.

The shortest useful mental model is:

```text
prove what and where
    -> predict safely
    -> change one representative target
    -> verify the real service
    -> expand in bounded steps
    -> stop or recover on evidence
    -> record and reconcile the outcome
```

That model applies to configuration enforcement, patching, security remediation, and deployments. The details differ, but safe automation always spends authority gradually and treats verification as part of the change rather than an optional report afterward.

Limits and tags need particular discipline in recovery. A limit answers “which hosts may participate in this run?” A tag answers “which selected tasks may participate?” Running `--limit web01 --tags rollback` creates the intersection of both decisions. Record them together because either one can make a seemingly correct play skip essential work.

Extra variables should be treated as deployment input, not an invisible command-line convenience. Prefer a reviewed JSON or YAML file for several related values, archive its nonsecret contents with the run, and validate every required field. Never pass a secret directly on a command line where process listings and shell history may capture it.

Vault-encrypted files protect values at rest in source, while Vault identities determine decryption during a run. They do not protect decrypted values in module arguments, templates, managed-node files, callback output, or delegated commands. Mark sensitive tasks with a narrow `no_log: true`, avoid diff for secret-bearing templates, and apply restrictive destination modes.

`no_log` is a tradeoff during failure. It can hide the details needed to diagnose a production incident. Keep the protected scope as small as possible, make surrounding task names and nonsecret status clear, and provide a secure debugging procedure for authorized operators rather than removing the boundary in an emergency.

Tags such as `always` and `never` have special execution behavior. Use them sparingly and test the command combinations operators will run. A safety assertion or mandatory preflight may need `always`; a destructive maintenance task may use `never` so it requires explicit selection. Names do not replace authorization, so the pipeline still controls who can launch the job.

The record should distinguish the requested host pattern from the resolved host list. Inventory can change between a pull request preview and a production job, especially with dynamic plugins. Store the resolved list at execution time and highlight additions relative to the reviewed cohort.

Finally, close the feedback loop after a successful release. Review changed counts, elapsed time, retries, health trends, and manual interventions. Unexpected constant changes point to idempotency debt; slow batches may need capacity or timeout work; repeated overrides should become reviewed configuration. The workflow improves by turning operational evidence back into source and test improvements.

A change can also succeed technically while violating the intended schedule or ownership process. Record who initiated it, which approval authorized it, and whether the run occurred inside the maintenance window. Automation platforms make these checks enforceable; a standalone command depends more heavily on operator discipline.

If a stage is deliberately skipped, record why and who accepted the resulting uncertainty. An emergency security repair might shorten the canary observation window, but it should not pretend that the missing evidence exists. Explicit risk acceptance is safer than silently weakening the workflow.

The final handoff should state whether the fleet is fully converged, partially converged but stable, rolled back, or awaiting recovery. “Job finished” is not enough. Include any hosts left drained, tasks deferred, temporary exceptions, and the owner and deadline for reconciliation. This keeps a bounded incident from becoming undocumented long-term drift.

When the same workflow runs on a schedule for routine drift control, keep the same careful evidence discipline throughout. A scheduled run still needs an approved source revision, scoped identity, stable inventory query, failure alert, and accountable owner. Automatic repetition lowers recovery time only when somebody notices, investigates, and resolves a failed or unexpectedly changing run.

Keep evidence attached to the same execution identity. Record the repository revision, inventory source, runtime, credentials domain, selected hosts, and relevant overrides so a rerun or incident review reconstructs the actual workflow rather than an approximate command from memory. This provenance connects authored intent to observed result and makes gradual expansion auditable.

Treat a manual intervention as a new input to the workflow. Record it, re-observe the host, and let the next playbook run reconcile from that state. Otherwise the team may interpret the resulting `changed` or failure as a playbook defect when it is evidence of an unrecorded change outside automation.

Verification sometimes needs to wait for state rather than check it once. `ansible.builtin.wait_for` can bound a wait for a port, file, or connection state after a restart. Give the wait an explicit timeout and follow it with a service-level assertion; a listening socket is useful readiness evidence, but it does not prove that the application returns correct responses.

## Check Your Answers

:::expand[Why Must the Workflow Start with Intent and Scope?]{kind="recap"}
Define the change, target, invariants, success signals, stop rules, and recovery before translating them into tasks and dependencies.
:::

:::expand[How Do You Validate the Target and Execution Path?]{kind="recap"}
Resolve host scope and variables, then prove connection, remote runtime, privilege, local execution, and delegation as separate boundaries.
:::

:::expand[What Can Syntax Checks, Linting, Check Mode, and Diff Prove?]{kind="recap"}
They catch source and predicted-state problems with increasing context, but module support, runtime values, and sensitive output limit simulation.
:::

:::expand[Why Should the First Real Run Be a Canary?]{kind="recap"}
A representative canary exposes real platform and service behavior with bounded blast radius. Widen only after structured results and health evidence pass.
:::

:::expand[How Do You Widen a Rollout Without Losing Control?]{kind="recap"}
Use capacity-aware serial batches, drain and health sequences, explicit limits, failure thresholds, and monitoring gates between stages.
:::

:::expand[How Should Failure and Rollback Be Designed?]{kind="recap"}
Predesign stop and recovery behavior, keep previous artifacts, distinguish deployment from data rollback, and remember that blocks are not transactions.
:::

:::expand[How Do Git, CI, and Automation Controllers Strengthen the Workflow?]{kind="recap"}
They make source, dependencies, targets, credentials, approvals, execution environments, and outcomes reviewable, reproducible, scoped, and recorded.
:::

:::expand[What Does the Complete Workflow Prove?]{kind="recap"}
Each stage proves one bounded claim and authorizes the next, progressively reducing uncertainty from intent through canary, rollout, verification, and evidence.
:::

---

**References**

- [Ansible: Validating tasks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Ansible: Patterns](https://docs.ansible.com/ansible/latest/inventory_guide/intro_patterns.html)
- [Ansible: Controlling playbook execution](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_startnstep.html)
- [Ansible: Delegation](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_delegation.html)
- [Ansible: Blocks and error handling](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_blocks.html)
- [Ansible: Error handling](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_error_handling.html)
- [Ansible: Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
- [Ansible Lint](https://ansible.readthedocs.io/projects/lint/)
- [Ansible Automation Platform](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/)
