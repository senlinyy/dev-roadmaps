---
title: "Idempotency"
description: "Understand why repeated Ansible runs should settle when hosts already match the playbook."
overview: "Idempotency is the behavior that lets Ansible configure hosts repeatedly without stacking the same change again."
tags: ["ansible", "idempotency", "changed"]
order: 3
id: article-infrastructure-as-code-ansible-playbooks-tasks-idempotency
aliases:
  - playbooks-tasks-idempotency
  - infrastructure-as-code/ansible/playbooks-tasks-idempotency.md
---

## Table of Contents

1. [What Does Idempotency Mean?](#what-does-idempotency-mean)
2. [Why Do Desired-State Modules Converge?](#why-do-desired-state-modules-converge)
3. [How Can Command Tasks Prove Their State?](#how-can-command-tasks-prove-their-state)
4. [Why Must Changed and Failed Be Truthful?](#why-must-changed-and-failed-be-truthful)
5. [How Do You Prove the Second Run Settles?](#how-do-you-prove-the-second-run-settles)
6. [What Causes Repeated Change Noise?](#what-causes-repeated-change-noise)
7. [How Does Idempotency Help Recovery?](#how-does-idempotency-help-recovery)
8. [How Do You Reason About Any Task?](#how-do-you-reason-about-any-task)
9. [Check Your Answers](#check-your-answers)

**Idempotency** means an operation can run more than once and still leave the system in the intended final state. In Ansible work, the first run may install packages, write files, and start services. A later run against the same host should usually report `ok` for those tasks because the host already matches the playbook.

![Idempotent Second Run](/content-assets/articles/article-infrastructure-as-code-ansible-playbooks-tasks-idempotency/idempotent-second-run.png)

*The second-run view shows the goal of idempotency: the first run may change a host, while the next run reports ok because the desired state already holds.*

Use the application platform from the previous article. The team manages `application-web-01` and `application-web-02`, and both hosts need Nginx, an `application-api` package, a config directory, a rendered config file, and a running service. The first production rollout may change both hosts. A health-repair run the next morning should confirm the same state instead of rewriting files and restarting services for no reason.

That settled second run is more than a neat Ansible feature. It is the reason operators trust playbook output during incidents. If a playbook reports `changed` on a host, the team should be able to ask what moved: a package version, a config file, a service state, or a deliberate release value.

Keep these questions in view as you work through the lesson:

1. **What Does Idempotency Mean?**
2. **Why Do Desired-State Modules Converge?**
3. **How Can Command Tasks Prove Their State?**
4. **Why Must Changed and Failed Be Truthful?**
5. **How Do You Prove the Second Run Settles?**
6. **What Causes Repeated Change Noise?**
7. **How Does Idempotency Help Recovery?**
8. **How Do You Reason About Any Task?**

## What Does Idempotency Mean?
<!-- section-summary: Idempotency means the playbook can run again and leave an already-correct host alone. -->

The mathematical shorthand is:

```text
f(f(x)) = f(x)
```

After applying operation `f` once, applying it again produces the same relevant state. In infrastructure terms, the first run moves the host toward the declared state; later runs observe that the state already holds and do not repeat unnecessary transitions.

Ansible is strongest when tasks describe state rather than imperative actions. “Package `application-api` is present,” “directory `/etc/application-api` has this ownership,” and “service is started” each give a module something observable to compare. “Run this installer” says only what action to perform and hides the lasting postcondition.

Idempotency is therefore better understood as convergence. A host can start from several realistic states—missing package, wrong file mode, stopped service, or already correct—and the same task set moves each toward one desired result. Once there, repetition remains stable.

There are two kinds of idempotency bug. A **state bug** repeats a real side effect: appending the same line, recreating an account, or restarting unnecessarily. A **reporting bug** leaves state alone but still reports `changed`, polluting handlers and run evidence. Production automation must avoid both.

## Why Do Desired-State Modules Converge?
<!-- section-summary: State-aware modules inspect the host and change only when the current state differs from the requested state. -->

Many Ansible modules are built around **desired state**. The task says what should be true, and the module checks the host before it acts. The `package` module can see whether a package is present. The `file` module can inspect ownership and permissions. The `template` module can compare rendered content with the file already on the remote host.

```yaml
- name: Keep application configuration directory present
  ansible.builtin.file:
    path: /etc/application-api
    state: directory
    owner: root
    group: application
    mode: "0750"

- name: Install application API package
  ansible.builtin.package:
    name: application-api
    state: present

- name: Render application API configuration
  ansible.builtin.template:
    src: application-api.yml.j2
    dest: /etc/application-api/config.yml
    owner: root
    group: application
    mode: "0640"
  notify: Restart application API
```

These tasks are state-aware. If the directory already has the right owner, group, and mode, the file task reports `ok`. If the package already exists, the package task reports `ok`. If the rendered template matches the remote file byte for byte, the template task reports `ok` and the handler stays quiet.

That last detail matters in production. A config template that reports `changed` every run will notify the restart handler every run. The application API might survive that restart. The output has become noisy, and a deploy report with constant change makes drift and real releases harder to see.

Each module compares a different kind of state. A package module queries the package manager. A directory task checks type, ownership, mode, and other requested attributes. A service task checks whether the service is started or enabled. A template renders fixed inputs and compares the resulting bytes and metadata with the remote destination.

This also lets an idempotent playbook repair drift. If someone changes a managed file manually, the next run reports a meaningful change and restores the declared content. Idempotency does not mean “never change after the first run.” It means change only when current state differs from the fixed desired state.

The desired state must itself be stable. `state: present` asks whether a package exists; `state: latest` asks whether it matches a moving repository. `state: started` asks whether a service is running; `state: restarted` requests an action every time. Choose parameters that express the intended contract rather than assuming every state keyword is naturally quiet.

Purpose-built modules already own observation and transition logic, reducing races and duplicated checks. Running a shell command to test whether a directory exists and then another command to create it is weaker than one `file` task that converges the directory atomically enough for its module contract.

## How Can Command Tasks Prove Their State?
<!-- section-summary: Raw commands need guards or custom status rules because arbitrary commands hide their lasting state. -->

The `ansible.builtin.command` and `ansible.builtin.shell` modules are useful for tools without a dedicated Ansible module. They also need extra care because Ansible has no built-in understanding of an arbitrary command's lasting state. A command may read a value, install software, generate a file, restart a service, or perform a mix of all four.


![Command Evidence Gate](/content-assets/articles/article-infrastructure-as-code-ansible-playbooks-tasks-idempotency/command-evidence-gate.png)

*The command gate shows how creates, removes, changed_when, and failed_when turn shell-shaped work into honest status.*

This task runs an installer every time, so it reports `changed` every time. The recap will stay noisy until the task has a guard.

```yaml
- name: Run application API installer
  ansible.builtin.command: /opt/application-api/install.sh
```

If the installer creates a stable marker file, `creates` turns the command into a one-time operation. Ansible checks the path first and skips the command after the marker exists.

```yaml
- name: Run application API installer once
  ansible.builtin.command:
    cmd: /opt/application-api/install.sh
    creates: /opt/application-api/.installed
```

For cleanup commands, `removes` gives the opposite guard. The command runs only while the target path exists. That is useful for one-time migrations away from old files.

```yaml
- name: Remove legacy application API config once
  ansible.builtin.command:
    cmd: /usr/local/bin/application-cleanup-old-config
    removes: /etc/application-api/legacy.yml
```

For read-only checks, the task should usually report `ok`. The command still runs, and the result can be registered for later tasks. The `changed_when: false` line keeps the recap honest.

```yaml
- name: Check application API version
  ansible.builtin.command: application-api --version
  register: application_api_version
  changed_when: false
```

The practical rule is simple. A command task should have evidence for its status. That evidence can be a marker file, a removed path, an exact output string, a return code, or a documented JSON field from the tool.

For production commands, prefer evidence the tool promises to keep stable. A JSON field such as `{"changed": true}` or a documented return code is safer than matching a friendly sentence in human output. If the command has its own dry-run or status command, run that first in staging and write the Ansible condition around the documented behavior.

`creates` represents a postcondition: once this path exists, Ansible assumes the operation's intended lasting result already holds. That is only as strong as the marker. An empty file may remain after a partial installer failure, so prefer a marker written atomically at successful completion or verify a stronger version and health condition.

Sometimes file existence is too weak. A migration may need a schema version, an API operation may return an object ID, and a generated artifact may need a checksum. Run a read-only status command, parse a documented field, and execute mutation only when that observed value differs from the desired input.

Commands with meaningful exit codes can translate them directly. A tool might use `0` for already current, `2` for updated, and other codes for failure. `changed_when` can map code `2` to change while `failed_when` accepts only the documented success codes. This is stronger than searching human prose that may change between releases.

Evidence should answer both questions: “must the transition run?” and “did it succeed?” A guard that skips future execution but cannot distinguish partial failure from completion creates false idempotence. A task that always runs and always says changed creates noise instead. Design the observation and postcondition before writing the command line.

## Why Must Changed and Failed Be Truthful?
<!-- section-summary: changed_when and failed_when let command-like tasks report status from stable return codes or output contracts. -->

Some production tools have their own status language. A CLI may return `0` for success and print `updated` only when it actually changed remote state. Another tool may return a special code when it finds drift. Ansible gives you `changed_when` and `failed_when` so the playbook can translate those tool results into Ansible status.

For the application platform, suppose a policy tool applies routing rules for the API gateway. It prints `updated` when it changes the active policy and `already current` when nothing changed.

```yaml
- name: Apply application routing policy
  ansible.builtin.command: applicationctl routing apply /etc/application-api/routing.yml
  register: routing_apply
  changed_when: "'updated' in routing_apply.stdout"
  failed_when: routing_apply.rc != 0
```

Now `changed` means the policy actually moved. That status can safely notify a handler, appear in a deployment report, or trigger a follow-up health check. The return code still controls failure, so the play stops if the CLI reports an error.

Validation commands often use the same pattern. A validation command reads state and should report `ok` when the check passes. It should fail the host when validation fails.

```yaml
- name: Validate application API configuration
  ansible.builtin.command: application-api --check-config /etc/application-api/config.yml
  register: config_validation
  changed_when: false
  failed_when: config_validation.rc != 0
```

These custom rules should come from a stable contract. If the tool has documented return codes or JSON output, use that. If the playbook searches for a vague word in human output, a future CLI message can make the task lie. In production, truthful status is more valuable than clever parsing.

`changed` is not cosmetic because Ansible uses it to notify handlers, summarize drift, support deployment review, and trigger surrounding workflow. A false positive can restart a service every run. A false negative can leave a changed config without its required reload.

Do not silence a non-idempotent command with `changed_when: false`. That changes the report, not the side effect. First give the command a reliable guard or replace it with a state-aware module; then make reporting match the real behavior.

Error truthfulness matters too. A command may use a nonzero code for “difference found” rather than failure, or return zero while a JSON field reports rejection. `failed_when` should encode the documented contract so failed state transitions stop the play and successful observations do not create false alarms.

Handlers make the contract concrete: only a real change should notify, and the handler should perform the necessary secondary action. Keep service restarts out of unconditional task flow when a file or package change can notify them precisely.

## How Do You Prove the Second Run Settles?
<!-- section-summary: Running the same playbook twice against a safe target exposes unstable templates, unguarded commands, and repeated restarts. -->

The most practical idempotency check is a two-run test against a safe target. A canary host or disposable staging host is enough to catch many common mistakes. The first run applies the desired state, and the second run should usually settle with zero changes for configuration tasks.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-01.staging.example.com
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-01.staging.example.com
```

Before the real run, check mode and diff mode can show likely file changes. That preview is especially useful for templates and file edits.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-01.staging.example.com --check --diff
```

Check mode has limits. Some modules lack prediction support, and tasks that depend on registered results from earlier tasks may behave differently in simulation. The two-run test gives stronger evidence because it observes a real host after a real application of the playbook.

When the second run still reports `changed`, the task name points to the next investigation. A template may contain a timestamp such as `{{ ansible_date_time.iso8601 }}` that changes every run. A package task may use `state: latest`, which asks for updates whenever the repository offers a newer package. A service task with `state: restarted` restarts every run. A command task may need `creates`, `removes`, or `changed_when`.

The stronger proof has three parts: fixed inputs, a real first run that reaches desired state, and a real second run with no unintended change. If inventory, package repositories, timestamps, facts, or release values change between runs, the test no longer isolates idempotency.

Check mode is useful before the first run, but it is not the proof. It predicts with module-specific support and may skip commands or produce different registered data. The second real run observes the state produced by the first real run and is therefore stronger evidence of convergence.

Test representative starting states too. A clean host proves installation, an already-correct host proves settling, and a deliberately drifted file proves repair. For recovery-sensitive work, an interrupted or partially applied fixture reveals whether a retry converges or repeats a destructive action.

Record expected changes in the first run. Release version updates and deliberate configuration changes should be visible; read-only validations should remain `ok`. Then require the second run to be quiet except for tasks whose semantics intentionally act every time.

## What Causes Repeated Change Noise?
<!-- section-summary: Noisy changes usually come from unstable values, broad package states, unconditional restarts, or unguarded commands. -->

Production playbooks should make noise only when something meaningful changed. The common noise sources are predictable. Dynamic values in templates create a different file on every run. `state: latest` turns package freshness into a moving target. `state: restarted` forces a service restart every run. Raw commands report changed unless the task tells Ansible how to decide.

The safer pattern is to make release inputs explicit. For the application API, pin the application release through a variable and let the package repository or deployment role use that value. Then the change shows up as a reviewed variable change or a logged runtime override.

```yaml
application_api_release: "2026.06.13"
application_api_config_checksum: "{{ application_api_public_name }}:{{ application_api_listen_port }}"
```

The second-run review should name the noisy task, its current status rule, and the desired fix. A template with `{{ ansible_date_time.iso8601 }}` should move that timestamp out of the managed file unless the timestamp is part of the real desired state. A package task using `state: latest` should usually become a pinned version for production releases. A service task using `state: restarted` should usually move to a handler notified by a real file or package change.

Random values cause the same problem as timestamps. A newly generated token, UUID, or password changes the desired content on every evaluation unless it is created once and stored as persistent state. Generation and steady-state consumption should be separate workflows.

Unstable ordering can create noise even when values are equal as sets. Sort lists before rendering when order has no semantic meaning, and use deterministic serialization. Otherwise two runs may alternate content and notify handlers without any policy change.

`state: restarted` is an imperative request: stop and start now. `state: started` is a desired state: ensure the service is running. Use a restart handler for actual dependent change, not a restart task as a substitute for convergence.

External inputs can move between runs. A package repository's newest version, an unpinned URL, current time, and live cloud query all change the function's inputs. An idempotency test applies only to fixed inputs; production reproducibility often requires pinning these values deliberately.

## How Does Idempotency Help Recovery?
<!-- section-summary: Convergent tasks make retries and repairs safer, while rollback still needs a defined previous state. -->

Rollback uses the same idea. If a release breaks the canary, the team restores the previous release value and runs the playbook through the same narrow path. Normal rollback should use the same reviewed playbook path as rollout.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com -e application_api_release=2026.06.12
```

For configuration files, `ansible.builtin.template` supports a `backup` option that can keep a timestamped copy of the previous file on the target. Many teams prefer Git as the main rollback record and target-side backups as an emergency aid. The safest approach is to test both: revert the repository change in staging, run the playbook, and confirm the service returns to the previous behavior.

Destructive work needs even more care. Removing directories, rotating credentials, and running database migrations should have clear guards, backups, and a tested restore path. Idempotency protects repeated configuration runs, and it should be combined with normal operational safety for changes that can destroy data.

Idempotency does not mean rollback. Reapplying the new desired state converges toward the new state; it does not reconstruct the old package, file, data, or external side effect. Rollback requires a previous desired input, backup, inverse operation, restore procedure, or forward fix.

It does make retries safer. A network failure can interrupt a play after several hosts or tasks have changed. Re-running a convergent play should observe completed state, skip it, and continue with missing transitions. An unguarded command may instead repeat an irreversible action.

This is why partial-state testing matters for migrations and provisioners. A marker should be written only after success, a database change should record its schema version, and an API create operation should preserve an idempotency key or discovered resource ID where the service supports it.

Rollback through the same playbook path works when the previous state is expressible as inputs. Restore the previous release and configuration values, then let state-aware modules compare and converge. Verify the result just as carefully as the forward rollout; “idempotent” does not guarantee the old application behavior is healthy.

## How Do You Reason About Any Task?
<!-- section-summary: Idempotent automation gives the team a reliable signal because changed, ok, and failed each mean something specific. -->

The application platform playbook now uses state-aware modules for packages, directories, templates, and services. Command tasks have evidence through `creates`, `removes`, `changed_when`, or `failed_when`. Validation tasks register output and report `ok` when they only read state. Handlers restart services only after a task reports a real change.


![Idempotency Summary](/content-assets/articles/article-infrastructure-as-code-ansible-playbooks-tasks-idempotency/idempotency-summary.png)

*The summary connects desired state, evidence, truthful changed status, second-run proof, and rollback safety.*

The team can prove the behavior with a canary. The first run may change the host. The second run should settle. If tomorrow's scheduled run reports a new change, the recap now means something: the desired state changed, the host drifted, or a task needs a better status rule.

That trustworthy output prepares the next skill. Once tasks report status honestly, operators can read the playbook output as evidence instead of terminal noise.

Reason about any task with five questions:

1. What exact end state should hold?
2. How can the task observe current state?
3. What evidence says a transition is necessary?
4. Can a purpose-built module own the comparison and transition?
5. Will `ok`, `changed`, and `failed` truthfully describe the outcome?

The deeper model is a feedback loop: observe current state, compare it with fixed desired inputs, perform only the required transition, and report the evidence. Repetition converges because the comparison becomes equal after success.

The next article focuses on playbook output. It shows how to separate `failed` from `unreachable`, how to read `changed` in context, and how the final recap tells the story of a run across multiple hosts.

Convergence also depends on the observation being trustworthy. A stale cache, weak marker, or command that checks the wrong host can tell Ansible the desired state already holds when it does not. Prefer the authoritative system interface—a package database, file checksum, service manager, schema version, or API resource identity—and invalidate caches when the workflow changes the observed state.

An idempotency review should therefore inspect more than the second-run recap. Confirm that a deliberately drifted state is repaired, an interrupted transition resumes safely, and a changed input produces only the expected dependent actions. Quiet output is valuable only when the observation behind `ok` is strong enough to justify it.

External APIs often support idempotency keys for create or payment-like operations. When Ansible must call such an API, derive a stable key from the deployment or desired resource identity and persist the returned resource identifier. Retrying with a new random key can duplicate the effect even if the task's Ansible status looks reasonable. When the API offers no idempotent create contract, separate discovery from creation, bound retries carefully, and document the manual reconciliation path after an ambiguous timeout.

Destructive absence is idempotent in a narrow mathematical sense—a path remains absent on repeated runs—but can still be unsafe. Safety also asks whether the target is correct, whether data should be retained, and whether recovery exists. Do not use idempotency as a synonym for harmlessness; it describes repeated end state, not business consequence.

Purpose-built state modules make the evidence explicit. `ansible.builtin.user` can compare an account with its desired properties, and `ansible.builtin.service` can distinguish an already-running service from one that needs a transition. External `lookup(...)` data and forced update options can change between runs, so they must be treated as inputs to convergence rather than proof of it. The second-run check should use the same inputs and still report no unintended changes.

## Check Your Answers

:::expand[What Does Idempotency Mean?]{kind="recap"}
Idempotency means repeated application with fixed inputs settles at the same desired state. It is convergence, not a promise that the first run never changes anything.
:::

:::expand[Why Do Desired-State Modules Converge?]{kind="recap"}
State-aware modules observe packages, files, directories, and services before transitioning. They can repair drift and then become quiet once the requested state holds.
:::

:::expand[How Can Command Tasks Prove Their State?]{kind="recap"}
Commands need stable evidence such as a strong postcondition, version, checksum, documented return code, or structured output. A weak marker can hide partial failure.
:::

:::expand[Why Must Changed and Failed Be Truthful?]{kind="recap"}
Status controls handlers, drift signals, and deployment decisions. Do not hide side effects with `changed_when: false`; translate the tool's real result contract.
:::

:::expand[How Do You Prove the Second Run Settles?]{kind="recap"}
Hold inputs fixed, apply once for real, and run again. Check mode is useful prediction, while the second real run is stronger convergence evidence.
:::

:::expand[What Causes Repeated Change Noise?]{kind="recap"}
Timestamps, randomness, unstable ordering, `latest`, unconditional restarts, moving inputs, and unguarded commands make the desired state or report change every run.
:::

:::expand[How Does Idempotency Help Recovery?]{kind="recap"}
Convergent tasks make interrupted-run retries safer and can restore prior declared inputs. Rollback still needs the old state, backups, inverse operations, or recovery procedures.
:::

:::expand[How Do You Reason About Any Task?]{kind="recap"}
Define desired state, observation, transition evidence, the best module, and truthful result semantics. That loop turns action-shaped automation into reliable convergence.
:::

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Official overview of playbook execution, desired state, idempotency, check mode, and verification.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official details for `--check`, `--diff`, task-level `check_mode`, and diff safety.
- [ansible.builtin.command](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/command_module.html) - Official module reference for command execution, including `creates` and `removes`.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guidance for `changed_when`, `failed_when`, handlers and failure, and error behavior.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official handler behavior for service reloads and restarts.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for limits, syntax checks, check mode, diff mode, and playbook execution options.
