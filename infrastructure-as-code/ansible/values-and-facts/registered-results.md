---
title: "Registered Task Results"
description: "Use Ansible task output as data for later tasks."
overview: "Registered results capture the output of one task so another task can use it in the same run."
tags: ["ansible", "register", "conditionals"]
order: 4
id: article-infrastructure-as-code-ansible-registered-results
aliases:
  - values-and-facts/registered-results.md
  - infrastructure-as-code/ansible/values-and-facts/registered-results.md
---

## Table of Contents

1. [Task Output as Data](#task-output-as-data)
2. [The Shape of a Registered Result](#the-shape-of-a-registered-result)
3. [Validation Before Service Changes](#validation-before-service-changes)
4. [Branching from Health Checks](#branching-from-health-checks)
5. [changed_when and failed_when](#changed_when-and-failed_when)
6. [Skipped Tasks, Missing Fields, and Loops](#skipped-tasks-missing-fields-and-loops)
7. [Verification, Failure Reading, and Rollback](#verification-failure-reading-and-rollback)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## Task Output as Data
<!-- section-summary: A registered result saves one task's output as a variable that later tasks can use for the same host. -->

A **registered result** is the structured output from a task saved into a variable. It gives later tasks evidence from the current run. That evidence might be a return code, standard output, standard error, HTTP status, file metadata, a changed flag, or module-specific data.

In the orders platform, registered results help the playbook act carefully. It can render a config, validate the config, restart the API only after the config is safe, and call the health endpoint after the restart. Each host keeps its own result, so `orders-web-01` can continue while `orders-web-02` fails validation.

The key idea is that registered data belongs to the host that produced it. If a command runs on two web servers, each web server gets its own copy of the registered variable. Later `when` conditions read the value for the current host.

## The Shape of a Registered Result
<!-- section-summary: Registered variables usually contain common status fields plus module-specific fields. -->

The `register` keyword gives a name to the result from a task. A command task usually returns fields such as `rc`, `stdout`, `stderr`, `changed`, `failed`, `cmd`, `start`, and `end`. A URI task may return `status`, `content`, `json`, and headers. A template task may return file paths, checksums, and change status.

```yaml
- name: Check orders API version
  ansible.builtin.command: orders-api --version
  register: orders_api_version
  changed_when: false
```

During development, a debug task can show the structure. The team should use this on safe data first so the result shape is clear.

```yaml
- name: Show orders API version result
  ansible.builtin.debug:
    var: orders_api_version
  tags:
    - debug-results
```

The result is structured data, even when the terminal output looks like plain text. A later task can read `orders_api_version.rc` or `orders_api_version.stdout`. That is much safer than guessing from the playbook output after the fact.

Debug output needs discipline. Registered results can include secrets, tokens, request bodies, headers, command arguments, or file content. Use debug tasks for safe values, guard them with tags, and use `no_log: true` for tasks that may expose sensitive data.

| Field | Common source | How teams use it |
|---|---|---|
| `changed` | Most modules | Decide whether a handler or report should treat the task as a real change. |
| `failed` | Most modules | Branch in rescue logic or stop with a clearer message. |
| `rc` | `command` and `shell` | Read a documented return code. |
| `stdout` / `stderr` | `command` and `shell` | Inspect safe command output during troubleshooting. |
| `status` | `uri` | Check HTTP health and API responses. |
| `json` | API modules or `uri` | Read machine-friendly response data. |
| `skipped` | Conditional tasks | Avoid reading fields from tasks that did not run. |
| `results` | Looping tasks | Walk per-item results from a loop. |

## Validation Before Service Changes
<!-- section-summary: Registered validation results let the playbook stop before a bad config turns into a bad service restart. -->

One common production use is validation. The orders API has a command that checks a config file and returns `0` when the config is valid. The playbook can register that result and make later tasks depend on it.

```yaml
- name: Render orders API config with built-in validation
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: /etc/orders-api/config.yml
    owner: root
    group: orders
    mode: "0640"
    backup: true
    validate: "orders-api --check-config %s"
  register: rendered_orders_config
  notify: Restart orders API
```

The `validate` option tells the template module to test a temporary rendered file before replacing the destination. The registered result still tells later tasks whether the template changed the host. This is a strong pattern because the service file is checked before Ansible writes it into place.

Sometimes validation is a separate tool call after several files are present. In that case, register the command result and make the status explicit so the recap stays honest.

```yaml
- name: Validate complete orders API configuration
  ansible.builtin.command: orders-api --check-config /etc/orders-api/config.yml
  register: orders_config_check
  changed_when: false
  failed_when: orders_config_check.rc != 0
```

The command only reads state, so `changed_when: false` keeps the recap quiet. The `failed_when` rule says any nonzero return code fails the host. If the command has documented nonzero codes that are acceptable, the playbook can express that explicitly.

Registered validation results can also control follow-up tasks. A post-render health check may only be useful after the config changed, so a readable fact can hold that decision.

```yaml
- name: Record that orders config changed during this run
  ansible.builtin.set_fact:
    orders_config_changed_this_run: "{{ rendered_orders_config.changed | default(false) }}"
```

That fact gives later tasks a readable condition. It also keeps the implementation detail of the template result in one place.

## Branching from Health Checks
<!-- section-summary: Health check results let a playbook wait, retry, fail, or continue based on service evidence. -->

A registered HTTP result is useful after a service restart. The playbook can call a local health endpoint and wait until the service reports ready. The `uri` module returns fields such as `status` and optionally `content`.

```yaml
- name: Check orders API health after config change
  ansible.builtin.uri:
    url: "http://127.0.0.1:{{ orders_api_listen_port }}/health"
    return_content: true
  register: orders_health
  changed_when: false
  retries: 6
  delay: 5
  until: orders_health.status == 200
  when: orders_config_changed_this_run | default(false) | bool
```

This task reads the service and retries for up to 30 seconds. It reports `ok` when the health endpoint returns HTTP 200. It fails the host if the service never reports healthy. The `when` condition keeps the health check tied to the change that made it relevant.

A follow-up task can print a safe summary when the health check fails. Be careful with full response bodies because they can contain environment details or customer data. A short status message is often enough for the playbook output.

```yaml
- name: Show orders API health status during debugging
  ansible.builtin.debug:
    msg: "orders API returned status {{ orders_health.status | default('unknown') }}"
  when:
    - orders_health is defined
    - orders_debug_output | default(false) | bool
```

This pattern makes the playbook act like a cautious operator. It changes a file, restarts only when needed, waits for the service, and records the result in the output.

## changed_when and failed_when
<!-- section-summary: Custom changed and failed rules translate tool-specific output into truthful Ansible status. -->

Registered results become most useful when paired with `changed_when` and `failed_when`. These keywords let the playbook define what change or failure means for tools that Ansible has no built-in understanding of.

For example, suppose `ordersctl routing apply` prints `updated` when it changes the live routing table and `already current` when no update was needed. The playbook can translate that tool-specific output into Ansible status.

```yaml
- name: Apply orders routing policy
  ansible.builtin.command: ordersctl routing apply /etc/orders-api/routing.yml
  register: routing_apply
  changed_when: "'updated' in routing_apply.stdout"
  failed_when: routing_apply.rc != 0
```

Now the recap shows `changed` only when the routing policy changed. This matters because a routing change may trigger a smoke test, a notification, or a rollback checkpoint.

Some tools use special return codes. Suppose `ordersctl drift check` returns `0` when there is no drift, `3` when drift exists, and any other code for execution failure. The playbook can treat drift as a failed deployment gate while still reporting the check itself as read-only.

```yaml
- name: Check orders policy drift
  ansible.builtin.command: ordersctl drift check --format json
  register: drift_check
  changed_when: false
  failed_when: drift_check.rc not in [0]
```

If the team wants to collect drift output without failing immediately, it can allow code `3` and branch later. That keeps the collection step separate from the decision step.

```yaml
- name: Check orders policy drift for reporting
  ansible.builtin.command: ordersctl drift check --format json
  register: drift_check
  changed_when: false
  failed_when: drift_check.rc not in [0, 3]

- name: Stop when orders policy drift exists
  ansible.builtin.fail:
    msg: "orders policy drift exists; review drift_check output"
  when: drift_check.rc == 3
```

These rules should match the tool's documented behavior. If a playbook treats a vague string as proof, a future CLI wording change can break the logic. Stable return codes and machine-readable output are better production signals.

## Skipped Tasks, Missing Fields, and Loops
<!-- section-summary: Registered variables need defensive checks when tasks skip, branch by host, or run in loops. -->

Registered variables can exist even when a task skipped. The result may contain skip metadata instead of the fields you expected from a normal command or module run. Later tasks should check that a result exists and ran normally before reading deep fields.

```yaml
- name: Reload only after validation ran and passed
  ansible.builtin.service:
    name: orders-api
    state: reloaded
  when:
    - orders_config_check is defined
    - not orders_config_check.skipped | default(false)
    - orders_config_check.rc == 0
```

This matters in mixed fleets. A Debian-only task can register a result on Debian hosts and skip on Red Hat hosts. A later task that blindly reads `orders_config_check.rc` can fail on hosts where the validation branch skipped.

Loops add another shape. When a task with `loop` registers a result, the registered variable usually contains a `results` list with one result per loop item. The playbook can inspect that list later.

```yaml
- name: Check required orders API paths
  ansible.builtin.stat:
    path: "{{ item }}"
  loop:
    - /etc/orders-api/config.yml
    - /etc/orders-api/routing.yml
  register: required_order_paths

- name: Fail when a required orders API path is missing
  ansible.builtin.fail:
    msg: "Missing required orders API path {{ item.item }}"
  loop: "{{ required_order_paths.results }}"
  when: not item.stat.exists
```

The `item.item` expression looks strange at first. The outer `item` is the current loop result in the second task. The inner `item` is the original path from the first loop. Debugging the registered result once in staging makes this shape much easier to understand.

## Verification, Failure Reading, and Rollback
<!-- section-summary: Registered-result workflows should be tested on a canary so validation, health checks, and rollback behavior are proven before a wide run. -->

Registered-result logic should be tested with both success and failure paths. A canary host can prove that validation passes, handlers run only after change, health checks retry, and bad results stop the host with a useful message.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-01.staging.example.com --check --diff
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit orders-web-01.staging.example.com
```

During failure reading, start with the registered task. If `orders_config_check.rc` is nonzero, inspect `stdout` and `stderr` from that task. If `orders_health.status` returns another status, inspect service logs and the rendered config. If a task fails because a field is undefined, check whether the task that registered the variable skipped for that host.

Rollback should use the same evidence path. If a new config fails validation before the template writes it, the host usually needs no file rollback. If a config writes successfully and the health check fails after restart, restore the previous release value or repository version and rerun against the affected host. The rollback run should include the same validation and health checks.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com -e orders_api_release=2026.06.12
```

For sensitive tasks, avoid dumping whole registered results in production logs. Use targeted debug messages that print safe fields, or rely on controller artifacts with controlled access. The registered result is powerful because it contains detail, and that same detail can become a secret leak if printed carelessly.

## Putting It All Together
<!-- section-summary: Registered results let Ansible make host-by-host decisions from evidence collected during the current run. -->

The orders platform playbook now uses registered results as live evidence. Template output tells the playbook whether config changed. Validation results decide whether the host can continue. Health check results prove that the service came back. Custom status rules keep read-only checks from polluting the change count.

This makes the playbook safer and easier to read. It pauses after commands that report bad evidence, restarts services for clear reasons, and keeps command status truthful. It uses structured output to make a clear decision for each host.

The next group moves into files and services. Registered results will show up again there because file changes, handlers, validation commands, and service health checks are a normal part of production automation.

## What's Next

The next article covers files and templates. It builds on everything here: variables feed templates, templates report changes, handlers react to those changes, and registered results help validate the service after the file lands.

---

**References**

- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html) - Official guide to registered variables in conditions, result fields, and conditional branching.
- [Return Values](https://docs.ansible.com/projects/ansible/latest/reference_appendices/common_return_values.html) - Official reference for common result fields such as `changed`, `failed`, `rc`, `stdout`, `stderr`, `skipped`, and `results`.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guidance for `failed_when`, `changed_when`, ignored failures, rescue blocks, and handler behavior after failures.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module reference for template rendering, backups, validation, file modes, and return data.
- [ansible.builtin.uri](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/uri_module.html) - Official module reference for HTTP requests, status codes, response content, and API checks.
- [ansible.builtin.set_fact](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/set_fact_module.html) - Official module reference for creating host variables during a playbook run.
- [ansible.builtin.debug](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/debug_module.html) - Official module reference for showing variables and messages during troubleshooting.
