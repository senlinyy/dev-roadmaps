---
title: "Registered Results"
description: "Use Ansible task output as data for later tasks."
overview: "Registered results capture the output of one task so another task can use it in the same run."
tags: ["ansible", "register", "conditionals"]
order: 4
id: article-infrastructure-as-code-ansible-registered-results
---

## Table of Contents

1. [What Registered Results Are](#what-registered-results-are)
2. [Reading the Result Shape](#reading-the-result-shape)
3. [Using Results in Conditions](#using-results-in-conditions)
4. [Changed and Failed Meaning](#changed-and-failed-meaning)
5. [Per-Host Results](#per-host-results)
6. [Common Surprises](#common-surprises)
7. [Putting It All Together](#putting-it-all-together)

## What Registered Results Are

Every Ansible task returns a result. Normal output shows the short version: `ok`, `changed`, `failed`, `skipped`, or `unreachable`. The full result can contain more data, such as a command return code, standard output, standard error, a file stat result, or an HTTP status.

`register` saves that full task result into a variable for later tasks on the same host.

For the orders service, you might validate the Nginx config before reloading the service:

```yaml
- name: Validate orders nginx config
  ansible.builtin.command: nginx -t
  register: orders_nginx_test
  changed_when: false
```

The variable `orders_nginx_test` now contains the result of that task. A later task can inspect it.

Registered results are useful when later work depends on evidence from earlier work. They are not a replacement for state-aware modules. If a module can directly manage the final state, use the module. Use `register` when the output of one task is genuinely needed by another task.

## Reading the Result Shape

The fields inside a registered result depend on the module. A command result usually includes fields such as `rc`, `stdout`, `stderr`, `stdout_lines`, and `stderr_lines`.

After this task runs:

```yaml
- name: Validate orders nginx config
  ansible.builtin.command: nginx -t
  register: orders_nginx_test
  changed_when: false
```

the result may contain data like this:

```yaml
orders_nginx_test:
  changed: false
  rc: 0
  stdout: ""
  stderr: "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok"
  stderr_lines:
    - "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok"
```

An HTTP result from the `uri` module has a different shape:

```yaml
- name: Check orders API health
  ansible.builtin.uri:
    url: "http://127.0.0.1:{{ orders_api_port }}/health"
    status_code: 200
  register: orders_health
  changed_when: false
```

That result may include a `status` field and response metadata. A file check from the `stat` module has yet another shape, usually under a nested `stat` key.

Do not guess forever. When learning a result's shape, print a narrow debug value in a safe environment:

```yaml
- name: Show orders health status
  ansible.builtin.debug:
    var: orders_health.status
```

Avoid printing full registered results when they may contain tokens, headers, file contents, or other sensitive data.

## Using Results in Conditions

A registered result can decide whether a later task should run.

For the orders API, the playbook can check whether a systemd unit file exists before trying to manage the service:

```yaml
- name: Check for orders API unit
  ansible.builtin.stat:
    path: /etc/systemd/system/orders-api.service
  register: orders_api_unit

- name: Start orders API when unit exists
  ansible.builtin.systemd_service:
    name: orders-api
    state: started
    enabled: true
  when: orders_api_unit.stat.exists
```

The first task observes the host. The second task acts only if the observation is true.

Keep this flow close together. A result registered near the top of a long play and used many screens later is hard to review. The reader has to remember where the value came from, which host produced it, and what shape it had.

## Changed and Failed Meaning

Registered command tasks often need explicit `changed_when` and `failed_when` rules.

A health check reads state. It should not count as a change:

```yaml
- name: Check orders API health
  ansible.builtin.command: curl -fsS http://127.0.0.1:3000/health
  register: orders_health
  changed_when: false
```

A command can also return codes where Ansible's default rule is too simple. By default, many command tasks treat a non-zero return code as failure. Sometimes the command uses return codes to report different valid observations.

This task checks for an optional maintenance flag:

```yaml
- name: Check orders maintenance flag
  ansible.builtin.command: test -f /etc/orders-api/maintenance.flag
  register: orders_maintenance_flag
  changed_when: false
  failed_when: orders_maintenance_flag.rc not in [0, 1]
```

Here `rc=0` means the flag exists. `rc=1` means it does not exist. Both are valid results. Any other return code means something unexpected happened.

These rules affect the rest of the play. A false `changed` can trigger handlers. A false `failed` can stop a host from running later tasks. A hidden failure can let a bad deployment continue.

## Per-Host Results

Registered variables are stored per host. If the orders play targets two web hosts, each host gets its own `orders_health` result.

The output may look like this:

```text
TASK [Check orders API health]
ok: [orders-web-01]
fatal: [orders-web-02]: FAILED! => {"status": 503}
```

After this task, `orders-web-01` has a successful `orders_health` value. `orders-web-02` has a failed result and may stop running later tasks unless the play handles the failure.

This per-host behavior is important when using registered results in conditions. A condition reads the result for the current host, not a shared global value from the first host that ran.

If a task uses a loop, the registered result usually contains a `results` list with one entry per loop item. That shape is useful, but it is also easy to make hard to read. For beginner playbooks, prefer simple one-result flows until you are comfortable with the result structure.

## Common Surprises

The first surprise is that `register` happens even when the task result is not `changed`. A read-only health check can register a result and still report `ok`.

The second surprise is that a skipped task can still leave a registered variable with skipped information. If a later task assumes a nested field exists, it may fail. Conditions should account for whether the earlier task actually ran.

The third surprise is that registered results are temporary. They exist during the playbook run. They are not a database, and they are not a long-term fact cache. If the next playbook run needs the same information, gather it again or store it in a real system of record.

The fourth surprise is that task output may contain sensitive data. A registered result from an API call can include response headers or body content. Treat debug output as carefully as logs.

## Putting It All Together

For the orders service, registered results give later tasks a way to use evidence from earlier tasks:

- A command validation can save `rc`, `stdout`, and `stderr`.
- A health check can save an HTTP status.
- A `stat` task can save whether a file exists.
- A later task can use those fields in `when`, `changed_when`, or `failed_when`.
- Each host keeps its own result.

Use registered results when a playbook needs to observe, then decide. Keep the observation close to the decision, define change and failure honestly, and avoid printing broad results that may contain secrets.

---

**References**

- [Conditionals: conditions based on registered variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html#conditions-based-on-registered-variables)
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html)
- [ansible.builtin.command module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/command_module.html)
- [ansible.builtin.stat module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/stat_module.html)
- [ansible.builtin.uri module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/uri_module.html)
