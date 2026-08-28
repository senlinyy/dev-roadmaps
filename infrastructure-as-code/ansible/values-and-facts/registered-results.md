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

1. [How Does a Task Result Become Data?](#how-does-a-task-result-become-data)
2. [Why Do Registered Result Shapes Differ?](#why-do-registered-result-shapes-differ)
3. [How Can Results Validate Before Service Changes?](#how-can-results-validate-before-service-changes)
4. [How Do Health Results Control Later Tasks?](#how-do-health-results-control-later-tasks)
5. [How Do changedwhen and failedwhen Interpret Results?](#how-do-changedwhen-and-failedwhen-interpret-results)
6. [How Do Skips, Missing Fields, and Loops Change the Shape?](#how-do-skips-missing-fields-and-loops-change-the-shape)
7. [How Should Results Support Verification and Recovery?](#how-should-results-support-verification-and-recovery)
8. [How Does the Complete Registered-Result Model Fit Together?](#how-does-the-complete-registered-result-model-fit-together)
9. [Check Your Answers](#check-your-answers)

A **registered result** is the structured output from a task saved into a variable. It gives later tasks evidence from the current run. That evidence might be a return code, standard output, standard error, HTTP status, file metadata, a changed flag, or module-specific data.

In the application platform, registered results help the playbook act carefully. It can render a config, validate the config, restart the API only after the config is safe, and call the health endpoint after the restart. Each host keeps its own result, so `application-web-01` can continue while `application-web-02` fails validation.

Keep these questions in view as you work through the lesson:

1. **How Does a Task Result Become Data?**
2. **Why Do Registered Result Shapes Differ?**
3. **How Can Results Validate Before Service Changes?**
4. **How Do Health Results Control Later Tasks?**
5. **How Do `changed_when` and `failed_when` Interpret Results?**
6. **How Do Skips, Missing Fields, and Loops Change the Shape?**
7. **How Should Results Support Verification and Recovery?**
8. **How Does the Complete Registered-Result Model Fit Together?**

## How Does a Task Result Become Data?
<!-- section-summary: A registered result saves one task's output as a variable that later tasks can use for the same host. -->

The key idea is that registered data belongs to the host that produced it. If a command runs on two web servers, each web server gets its own copy of the registered variable. Later `when` conditions read the value for the current host.

## Why Do Registered Result Shapes Differ?
<!-- section-summary: Registered variables usually contain common status fields plus module-specific fields. -->

The `register` keyword gives a name to the result from a task. A command task usually returns fields such as `rc`, `stdout`, `stderr`, `changed`, `failed`, `cmd`, `start`, and `end`. A URI task may return `status`, `content`, `json`, and headers. A template task may return file paths, checksums, and change status.


![Registered Result Shape](/content-assets/articles/article-infrastructure-as-code-ansible-registered-results/registered-result-shape.png)

*The result shape shows the fields a registered task result can carry into later decisions.*

```yaml
- name: Check application API version
  ansible.builtin.command: application-api --version
  register: application_api_version
  changed_when: false
```

During development, a debug task can show the structure. The team should use this on safe data first so the result shape is clear.

```yaml
- name: Show application API version result
  ansible.builtin.debug:
    var: application_api_version
  tags:
    - debug-results
```

The result is structured data, even when the terminal output looks like plain text. A later task can read `application_api_version.rc` or `application_api_version.stdout`. That is much safer than guessing from the playbook output after the fact.

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

## How Can Results Validate Before Service Changes?
<!-- section-summary: Registered validation results let the playbook stop before a bad config turns into a bad service restart. -->

One common production use is validation. The application API has a command that checks a config file and returns `0` when the config is valid. The playbook can register that result and make later tasks depend on it.

```yaml
- name: Render application API config with built-in validation
  ansible.builtin.template:
    src: application-api.yml.j2
    dest: /etc/application-api/config.yml
    owner: root
    group: application
    mode: "0640"
    backup: true
    validate: "application-api --check-config %s"
  register: rendered_application_config
  notify: Restart application API
```

The `validate` option tells the template module to test a temporary rendered file before replacing the destination. The registered result still tells later tasks whether the template changed the host. This is a strong pattern because the service file is checked before Ansible writes it into place.

Sometimes validation is a separate tool call after several files are present. In that case, register the command result and make the status explicit so the recap stays honest.

```yaml
- name: Validate complete application API configuration
  ansible.builtin.command: application-api --check-config /etc/application-api/config.yml
  register: application_config_check
  changed_when: false
  failed_when: application_config_check.rc != 0
```

The command only reads state, so `changed_when: false` keeps the recap quiet. The `failed_when` rule says any nonzero return code fails the host. If the command has documented nonzero codes that are acceptable, the playbook can express that explicitly.

Registered validation results can also control follow-up tasks. A post-render health check may only be useful after the config changed, so a readable fact can hold that decision.

```yaml
- name: Record that application config changed during this run
  ansible.builtin.set_fact:
    application_config_changed_this_run: "{{ rendered_application_config.changed | default(false) }}"
```

That fact gives later tasks a readable condition. It also keeps the implementation detail of the template result in one place.

## How Do Health Results Control Later Tasks?
<!-- section-summary: Health check results let a playbook wait, retry, fail, or continue based on service evidence. -->

A registered HTTP result is useful after a service restart. The playbook can call a local health endpoint and wait until the service reports ready. The `uri` module returns fields such as `status` and optionally `content`.


![Result Branching Flow](/content-assets/articles/article-infrastructure-as-code-ansible-registered-results/result-branching-flow.png)

*The branching flow shows a health-check result driving failed_when, changed_when, handler notification, or rollout stop decisions.*

```yaml
- name: Check application API health after config change
  ansible.builtin.uri:
    url: "http://127.0.0.1:{{ application_api_listen_port }}/health"
    return_content: true
  register: application_health
  changed_when: false
  retries: 6
  delay: 5
  until: application_health.status == 200
  when: application_config_changed_this_run | default(false) | bool
```

This task reads the service and retries for up to 30 seconds. It reports `ok` when the health endpoint returns HTTP 200. It fails the host if the service never reports healthy. The `when` condition keeps the health check tied to the change that made it relevant.

A follow-up task can print a safe summary when the health check fails. Be careful with full response bodies because they can contain environment details or customer data. A short status message is often enough for the playbook output.

```yaml
- name: Show application API health status during debugging
  ansible.builtin.debug:
    msg: "application API returned status {{ application_health.status | default('unknown') }}"
  when:
    - application_health is defined
    - application_debug_output | default(false) | bool
```

This pattern makes the playbook act like a cautious operator. It changes a file, restarts only when needed, waits for the service, and records the result in the output.

## How Do `changed_when` and `failed_when` Interpret Results?
<!-- section-summary: Custom changed and failed rules translate tool-specific output into truthful Ansible status. -->

Pairing registered results with `changed_when` and `failed_when` gives them the most value. These keywords let the playbook define what change or failure means for tools that Ansible has no built-in understanding of.

For example, suppose `applicationctl routing apply` prints `updated` when it changes the live routing table and `already current` when no update was needed. The playbook can translate that tool-specific output into Ansible status.

```yaml
- name: Apply application routing policy
  ansible.builtin.command: applicationctl routing apply /etc/application-api/routing.yml
  register: routing_apply
  changed_when: "'updated' in routing_apply.stdout"
  failed_when: routing_apply.rc != 0
```

Now the recap shows `changed` only when the routing policy changed. This matters because a routing change may trigger a smoke test, a notification, or a rollback checkpoint.

Some tools use special return codes. Suppose `applicationctl drift check` returns `0` when there is no drift, `3` when drift exists, and any other code for execution failure. The playbook can treat drift as a failed deployment gate while still reporting the check itself as read-only.

```yaml
- name: Check application policy drift
  ansible.builtin.command: applicationctl drift check --format json
  register: drift_check
  changed_when: false
  failed_when: drift_check.rc not in [0]
```

If the team wants to collect drift output without failing immediately, it can allow code `3` and branch later. That keeps the collection step separate from the decision step.

```yaml
- name: Check application policy drift for reporting
  ansible.builtin.command: applicationctl drift check --format json
  register: drift_check
  changed_when: false
  failed_when: drift_check.rc not in [0, 3]

- name: Stop when application policy drift exists
  ansible.builtin.fail:
    msg: "application policy drift exists; review drift_check output"
  when: drift_check.rc == 3
```

These rules should match the tool's documented behavior. If a playbook treats a vague string as proof, a future CLI wording change can break the logic. Stable return codes and machine-readable output are better production signals.

## How Do Skips, Missing Fields, and Loops Change the Shape?
<!-- section-summary: Registered variables need defensive checks when tasks skip, branch by host, or run in loops. -->

Registered variables can exist even when a task skipped. The result may contain skip metadata instead of the fields you expected from a normal command or module run. Later tasks should check that a result exists and ran normally before reading deep fields.

```yaml
- name: Reload only after validation ran and passed
  ansible.builtin.service:
    name: application-api
    state: reloaded
  when:
    - application_config_check is defined
    - not application_config_check.skipped | default(false)
    - application_config_check.rc == 0
```

This matters in mixed fleets. A Debian-only task can register a result on Debian hosts and skip on Red Hat hosts. A later task that blindly reads `application_config_check.rc` can fail on hosts where the validation branch skipped.

Loops add another shape. When a task with `loop` registers a result, the registered variable usually contains a `results` list with one result per loop item. The playbook can inspect that list later.

```yaml
- name: Check required application API paths
  ansible.builtin.stat:
    path: "{{ item }}"
  loop:
    - /etc/application-api/config.yml
    - /etc/application-api/routing.yml
  register: required_order_paths

- name: Fail when a required application API path is missing
  ansible.builtin.fail:
    msg: "Missing required application API path {{ item.item }}"
  loop: "{{ required_order_paths.results }}"
  when: not item.stat.exists
```

The `item.item` expression looks strange at first. The outer `item` is the current loop result in the second task. The inner `item` is the original path from the first loop. Debugging the registered result once in staging makes this shape much easier to understand.

## How Should Results Support Verification and Recovery?
<!-- section-summary: Registered-result workflows should be tested on a canary so validation, health checks, and rollback behavior are proven before a wide run. -->

Registered-result logic should be tested with both success and failure paths. A canary host can prove that validation passes, handlers run only after change, health checks retry, and bad results stop the host with a useful message.

```bash
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-01.staging.example.com --check --diff
ansible-playbook -i inventories/staging/hosts.yml site.yml --limit application-web-01.staging.example.com
```

During failure reading, start with the registered task. If `application_config_check.rc` is nonzero, inspect `stdout` and `stderr` from that task. If `application_health.status` returns another status, inspect service logs and the rendered config. If a task fails because a field is undefined, check whether the task that registered the variable skipped for that host.

Rollback should use the same evidence path. If a new config fails validation before the template writes it, the host usually needs no file rollback. If a config writes successfully and the health check fails after restart, restore the previous release value or repository version and rerun against the affected host. The rollback run should include the same validation and health checks.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com -e application_api_release=2026.06.12
```

For sensitive tasks, avoid dumping whole registered results in production logs. Use targeted debug messages that print safe fields, or rely on controller artifacts with controlled access. The registered result is powerful because it contains detail, and that same detail can become a secret leak if printed carelessly.

## How Does the Complete Registered-Result Model Fit Together?
<!-- section-summary: Registered results let Ansible make host-by-host decisions from evidence collected during the current run. -->

The application platform playbook now uses registered results as live evidence. Template output tells the playbook whether config changed. Validation results decide whether the host can continue. Health check results prove that the service came back. Custom status rules keep read-only checks from polluting the change count.


![Registered Results Summary](/content-assets/articles/article-infrastructure-as-code-ansible-registered-results/registered-results-summary.png)

*The summary turns registered output into a loop: capture, inspect, branch, report, and recover.*

This makes the playbook safer and easier to read. It pauses after commands that report bad evidence, restarts services for clear reasons, and keeps command status truthful. It uses structured output to make a clear decision for each host.

Registration does not create a global value. Each host stores the result produced by its own task, and the variable exists only for the current run. Normal variables describe intended input, facts describe host properties and can optionally be cached, while registered data describes one execution event. Use a fact only when later tasks or runs need host data beyond the immediate result flow.

Lists of `changed_when` or `failed_when` expressions are combined as logical AND. Use one explicit expression with `or` when either condition should trigger. The condition interprets the module result; it does not undo a remote action that already happened. A command can change the host and then be marked failed, leaving recovery work.

Skipped tasks still register a result object, but it may contain `skipped` and `skip_reason` instead of normal `stdout`, `status`, or provider fields. Test `result is defined`, `not result.skipped | default(false)`, and the field's definedness before reading it. Module-specific return structures belong in the module documentation.

Loops create a parent result with a `results` list. Each child entry carries its item and per-iteration status. A later task can filter failed items, report exactly which package or endpoint failed, and decide whether partial success is acceptable. Do not read `stdout` directly from the parent as if only one command ran.

Newer Ansible versions can project registered results in some loop and host workflows, but the core rule remains: inspect where the data is stored, when it becomes available, and which hosts or items produced it. Avoid clever projections when a direct per-host result is clearer.

Prefer a state-aware module over a command probe when the module already knows the desired state. Register a command when its domain output is the evidence the play needs, and translate its exit, change, and failure semantics explicitly.

Result timing also affects delegation and `run_once`. A delegated task still associates its ordinary registered result with the current inventory host unless facts are deliberately delegated. A `run_once` result can be available to later hosts in ways that look global, but designing a clear control-node play is safer for one true deployment-wide observation.

Failure conditions can preserve meaningful error information. A command returning `2` for “configuration invalid” and `3` for “dependency unavailable” should fail in both cases, while a later debug or rescue task can report the safe diagnostic fields and choose different recovery. Avoid replacing the original error with a generic assertion that discards `rc` and `stderr`.

Validation should happen before the change it protects whenever the tool accepts a candidate. The template module's `validate` option is stronger than writing the file, running a command, and discovering invalid syntax afterward. Register post-change commands for runtime properties that candidate validation cannot prove.

Registered variables can contain secrets: command output, HTTP bodies, headers, generated tokens, or module invocation data. `no_log: true` on the producing and consuming tasks prevents routine display, but do not later debug the whole value. Extract only nonsecret status or store evidence through a protected system.

The most useful durable mental model is a structured per-host execution event record: a specific module ran for a specific host or loop item at a specific point, returned a module-shaped object, and Ansible interpreted that object through default or custom change and failure rules. Later host-specific control flow remains operationally trustworthy only when those four facts, their timing, and their execution boundary are explicitly understood by the operator.

The next group moves into files and services. Registered results will show up again there because file changes, handlers, validation commands, and service health checks are a normal part of production automation.

### What Comes Next?

The next article covers files and templates. It builds on everything here: variables feed templates, templates report changes, handlers react to those changes, and registered results help validate the service after the file lands.

Registered data is ephemeral and host-scoped unless a deliberate cache or external store preserves it. A later play or separate run should not assume an earlier command result still exists. Re-observe authoritative state when a new execution needs the decision, especially after recovery or manual intervention.

Re-observation keeps later decisions grounded in current evidence.

Result shape follows the module. `ansible.builtin.package` reports package-state work, `ansible.builtin.copy` reports file details and change, and facts supply host observations rather than a command return code. Do not write one universal condition against fields that some of those results never define. Inspect the documented shape, guard optional fields, and keep the registered value scoped to the host that produced it.

## Check Your Answers

:::expand[How Does a Task Result Become Data?]{kind="recap"}
Every task returns structured per-host data; `register` gives that result a name for later decisions in the current run.
:::

:::expand[Why Do Registered Result Shapes Differ?]{kind="recap"}
Common status fields recur, while commands, HTTP modules, files, skips, and loops add different fields documented by their modules.
:::

:::expand[How Can Results Validate Before Service Changes?]{kind="recap"}
Capture a read-only validator, mark it unchanged, and stop before a restart or later mutation when its evidence fails.
:::

:::expand[How Do Health Results Control Later Tasks?]{kind="recap"}
Register health status and content, retry until the acceptance condition holds, and branch or stop separately for each host.
:::

:::expand[How Do `changed_when` and `failed_when` Interpret Results?]{kind="recap"}
They translate domain output into Ansible status after execution; they neither prevent nor reverse side effects already performed.
:::

:::expand[How Do Skips, Missing Fields, and Loops Change the Shape?]{kind="recap"}
Skipped results may lack normal fields, and loops store per-item records under `results`; guard and inspect the actual structure.
:::

:::expand[How Should Results Support Verification and Recovery?]{kind="recap"}
Use safe fields to locate the first failed boundary, determine prior mutation, verify service state, and drive a narrow audited recovery.
:::

:::expand[How Does the Complete Registered-Result Model Fit Together?]{kind="recap"}
Capture observations, interpret truthful status, branch per host or item, verify outcomes, and keep ephemeral evidence out of secret-bearing logs.
:::

---

**References**

- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html) - Official guide to registered variables in conditions, result fields, and conditional branching.
- [Return Values](https://docs.ansible.com/projects/ansible/latest/reference_appendices/common_return_values.html) - Official reference for common result fields such as `changed`, `failed`, `rc`, `stdout`, `stderr`, `skipped`, and `results`.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guidance for `failed_when`, `changed_when`, ignored failures, rescue blocks, and handler behavior after failures.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module reference for template rendering, backups, validation, file modes, and return data.
- [ansible.builtin.uri](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/uri_module.html) - Official module reference for HTTP requests, status codes, response content, and API checks.
- [ansible.builtin.set_fact](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/set_fact_module.html) - Official module reference for creating host variables during a playbook run.
- [ansible.builtin.debug](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/debug_module.html) - Official module reference for showing variables and messages during troubleshooting.
