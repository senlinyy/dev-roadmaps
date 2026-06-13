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

1. [Repeated Runs Should Settle](#repeated-runs-should-settle)
2. [Desired State Modules](#desired-state-modules)
3. [Command Tasks Need Evidence](#command-tasks-need-evidence)
4. [Truthful Changed and Failed Status](#truthful-changed-and-failed-status)
5. [Proving the Second Run](#proving-the-second-run)
6. [Common Change Noise and Rollback Safety](#common-change-noise-and-rollback-safety)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)
9. [References](#references)

## Repeated Runs Should Settle
<!-- section-summary: Idempotency means the playbook can run again and leave an already-correct host alone. -->

**Idempotency** means an operation can run more than once and still leave the system in the intended final state. In Ansible work, the first run may install packages, write files, and start services. A later run against the same host should usually report `ok` for those tasks because the host already matches the playbook.

Use the orders platform from the previous article. The team manages `orders-web-01` and `orders-web-02`, and both hosts need Nginx, an `orders-api` package, a config directory, a rendered config file, and a running service. The first production rollout may change both hosts. A health-repair run the next morning should confirm the same state instead of rewriting files and restarting services for no reason.

That settled second run is more than a neat Ansible feature. It is the reason operators trust playbook output during incidents. If a playbook reports `changed` on a host, the team should be able to ask what moved: a package version, a config file, a service state, or a deliberate release value.

## Desired State Modules
<!-- section-summary: State-aware modules inspect the host and change only when the current state differs from the requested state. -->

Many Ansible modules are built around **desired state**. The task says what should be true, and the module checks the host before it acts. The `package` module can see whether a package is present. The `file` module can inspect ownership and permissions. The `template` module can compare rendered content with the file already on the remote host.

```yaml
- name: Keep orders configuration directory present
  ansible.builtin.file:
    path: /etc/orders-api
    state: directory
    owner: root
    group: orders
    mode: "0750"

- name: Install orders API package
  ansible.builtin.package:
    name: orders-api
    state: present

- name: Render orders API configuration
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: /etc/orders-api/config.yml
    owner: root
    group: orders
    mode: "0640"
  notify: Restart orders API
```

These tasks are state-aware. If the directory already has the right owner, group, and mode, the file task reports `ok`. If the package already exists, the package task reports `ok`. If the rendered template matches the remote file byte for byte, the template task reports `ok` and the handler stays quiet.

That last detail matters in production. A config template that reports `changed` every run will notify the restart handler every run. The orders API might survive that restart. The output has become noisy, and a deploy report with constant change makes drift and real releases harder to see.

## Command Tasks Need Evidence
<!-- section-summary: Raw commands need guards or custom status rules because arbitrary commands hide their lasting state. -->

The `ansible.builtin.command` and `ansible.builtin.shell` modules are useful for tools without a dedicated Ansible module. They also need extra care because Ansible has no built-in understanding of an arbitrary command's lasting state. A command may read a value, install software, generate a file, restart a service, or perform a mix of all four.

This task runs an installer every time, so it reports `changed` every time. The recap will stay noisy until the task has a guard.

```yaml
- name: Run orders API installer
  ansible.builtin.command: /opt/orders-api/install.sh
```

If the installer creates a stable marker file, `creates` turns the command into a one-time operation. Ansible checks the path first and skips the command after the marker exists.

```yaml
- name: Run orders API installer once
  ansible.builtin.command:
    cmd: /opt/orders-api/install.sh
    creates: /opt/orders-api/.installed
```

For cleanup commands, `removes` gives the opposite guard. The command runs only while the target path exists. That is useful for one-time migrations away from old files.

```yaml
- name: Remove legacy orders API config once
  ansible.builtin.command:
    cmd: /usr/local/bin/orders-cleanup-old-config
    removes: /etc/orders-api/legacy.yml
```

For read-only checks, the task should usually report `ok`. The command still runs, and the result can be registered for later tasks. The `changed_when: false` line keeps the recap honest.

```yaml
- name: Check orders API version
  ansible.builtin.command: orders-api --version
  register: orders_api_version
  changed_when: false
```

The practical rule is simple. A command task should have evidence for its status. That evidence can be a marker file, a removed path, an exact output string, a return code, or a documented JSON field from the tool.

For production commands, prefer evidence the tool promises to keep stable. A JSON field such as `{"changed": true}` or a documented return code is safer than matching a friendly sentence in human output. If the command has its own dry-run or status command, run that first in staging and write the Ansible condition around the documented behavior.

## Truthful Changed and Failed Status
<!-- section-summary: changed_when and failed_when let command-like tasks report status from stable return codes or output contracts. -->

Some production tools have their own status language. A CLI may return `0` for success and print `updated` only when it actually changed remote state. Another tool may return a special code when it finds drift. Ansible gives you `changed_when` and `failed_when` so the playbook can translate those tool results into Ansible status.

For the orders platform, suppose a policy tool applies routing rules for the API gateway. It prints `updated` when it changes the active policy and `already current` when nothing changed.

```yaml
- name: Apply orders routing policy
  ansible.builtin.command: ordersctl routing apply /etc/orders-api/routing.yml
  register: routing_apply
  changed_when: "'updated' in routing_apply.stdout"
  failed_when: routing_apply.rc != 0
```

Now `changed` means the policy actually moved. That status can safely notify a handler, appear in a deployment report, or trigger a follow-up health check. The return code still controls failure, so the play stops if the CLI reports an error.

Validation commands often use the same pattern. A validation command reads state and should report `ok` when the check passes. It should fail the host when validation fails.

```yaml
- name: Validate orders API configuration
  ansible.builtin.command: orders-api --check-config /etc/orders-api/config.yml
  register: config_validation
  changed_when: false
  failed_when: config_validation.rc != 0
```

These custom rules should come from a stable contract. If the tool has documented return codes or JSON output, use that. If the playbook searches for a vague word in human output, a future CLI message can make the task lie. In production, truthful status is more valuable than clever parsing.

## Proving the Second Run
<!-- section-summary: Running the same playbook twice against a safe target exposes unstable templates, unguarded commands, and repeated restarts. -->

The most practical idempotency check is a two-run test against a safe target. A canary host or disposable staging host is enough to catch many common mistakes. The first run applies the desired state, and the second run should usually settle with zero changes for configuration tasks.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-01.staging.example.com
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-01.staging.example.com
```

Before the real run, check mode and diff mode can show likely file changes. That preview is especially useful for templates and file edits.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-01.staging.example.com --check --diff
```

Check mode has limits. Some modules lack prediction support, and tasks that depend on registered results from earlier tasks may behave differently in simulation. The two-run test gives stronger evidence because it observes a real host after a real application of the playbook.

When the second run still reports `changed`, the task name points to the next investigation. A template may contain a timestamp such as `{{ ansible_date_time.iso8601 }}` that changes every run. A package task may use `state: latest`, which asks for updates whenever the repository offers a newer package. A service task with `state: restarted` restarts every run. A command task may need `creates`, `removes`, or `changed_when`.

## Common Change Noise and Rollback Safety
<!-- section-summary: Noisy changes usually come from unstable values, broad package states, unconditional restarts, or unguarded commands. -->

Production playbooks should make noise only when something meaningful changed. The common noise sources are predictable. Dynamic values in templates create a different file on every run. `state: latest` turns package freshness into a moving target. `state: restarted` forces a service restart every run. Raw commands report changed unless the task tells Ansible how to decide.

The safer pattern is to make release inputs explicit. For the orders API, pin the application release through a variable and let the package repository or deployment role use that value. Then the change shows up as a reviewed variable change or a logged runtime override.

```yaml
orders_api_release: "2026.06.13"
orders_api_config_checksum: "{{ orders_api_public_name }}:{{ orders_api_listen_port }}"
```

The second-run review should name the noisy task, its current status rule, and the desired fix. A template with `{{ ansible_date_time.iso8601 }}` should move that timestamp out of the managed file unless the timestamp is part of the real desired state. A package task using `state: latest` should usually become a pinned version for production releases. A service task using `state: restarted` should usually move to a handler notified by a real file or package change.

Rollback uses the same idea. If a release breaks the canary, the team restores the previous release value and runs the playbook through the same narrow path. Normal rollback should use the same reviewed playbook path as rollout.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com -e orders_api_release=2026.06.12
```

For configuration files, `ansible.builtin.template` supports a `backup` option that can keep a timestamped copy of the previous file on the target. Many teams prefer Git as the main rollback record and target-side backups as an emergency aid. The safest approach is to test both: revert the repository change in staging, run the playbook, and confirm the service returns to the previous behavior.

Destructive work needs even more care. Removing directories, rotating credentials, and running database migrations should have clear guards, backups, and a tested restore path. Idempotency protects repeated configuration runs, and it should be combined with normal operational safety for changes that can destroy data.

## Putting It All Together
<!-- section-summary: Idempotent automation gives the team a reliable signal because changed, ok, and failed each mean something specific. -->

The orders platform playbook now uses state-aware modules for packages, directories, templates, and services. Command tasks have evidence through `creates`, `removes`, `changed_when`, or `failed_when`. Validation tasks register output and report `ok` when they only read state. Handlers restart services only after a task reports a real change.

The team can prove the behavior with a canary. The first run may change the host. The second run should settle. If tomorrow's scheduled run reports a new change, the recap now means something: the desired state changed, the host drifted, or a task needs a better status rule.

That trustworthy output prepares the next skill. Once tasks report status honestly, operators can read the playbook output as evidence instead of terminal noise.

## What's Next

The next article focuses on playbook output. It shows how to separate `failed` from `unreachable`, how to read `changed` in context, and how the final recap tells the story of a run across multiple hosts.

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Official overview of playbook execution, desired state, idempotency, check mode, and verification.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official details for `--check`, `--diff`, task-level `check_mode`, and diff safety.
- [ansible.builtin.command](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/command_module.html) - Official module reference for command execution, including `creates` and `removes`.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guidance for `changed_when`, `failed_when`, handlers and failure, and error behavior.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official handler behavior for service reloads and restarts.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for limits, syntax checks, check mode, diff mode, and playbook execution options.
