---
title: "Handlers and Restarts"
description: "Learn how Ansible change events notify handlers, why handlers deduplicate disruptive work, and how timing, validation, failure, reload, and restart semantics interact."
overview: "Changing configuration and changing a running process are separate operations. This article derives handlers from that boundary: modules emit meaningful changed events, notifications queue consequences, handlers run once at controlled points, and validation and recovery protect the service around restarts."
tags: ["ansible", "handlers", "restarts", "changed", "services"]
order: 3
id: article-infrastructure-as-code-ansible-handlers-service-restarts
aliases:
  - handlers-service-restarts
  - infrastructure-as-code/ansible/handlers-service-restarts.md
---

## Table of Contents

1. [Why Is Changing a File Different from Changing a Process?](#why-is-changing-a-file-different-from-changing-a-process)
2. [How Does changed Become a Handler Event?](#how-does-changed-become-a-handler-event)
3. [Why Does One Handler Run for Many Notifications?](#why-does-one-handler-run-for-many-notifications)
4. [When Should a Service Reload or Restart?](#when-should-a-service-reload-or-restart)
5. [When Do Handlers Run, and Why Flush Them?](#when-do-handlers-run-and-why-flush-them)
6. [How Do Validation and changedwhen Protect Restarts?](#how-do-validation-and-changedwhen-protect-restarts)
7. [What Happens to Handlers When Tasks Fail?](#what-happens-to-handlers-when-tasks-fail)
8. [How Do You Design a Safe Handler Flow?](#how-do-you-design-a-safe-handler-flow)
9. [Check Your Answers](#check-your-answers)

Writing a new configuration file does not make a running daemon reread it. Restarting a daemon on every Ansible run makes automation noisy and disruptive. Handlers connect these two facts: a state-aware task reports real change, and that event queues the necessary process consequence.

Suppose Nginx reads `/etc/nginx/nginx.conf` when it starts or reloads. Ansible renders a new file:

```yaml
- name: Render Nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
```

The filesystem now contains the desired bytes. The running Nginx process may still use the old in-memory configuration. These are two states:

```text
file state
    desired configuration stored on disk

process state
    configuration currently loaded by daemon
```

Adding an unconditional restart task closes the gap but restarts on every run:

```yaml
- name: Restart Nginx
  ansible.builtin.service:
    name: nginx
    state: restarted
```

Keep these questions in view as you work through the lesson:

1. **Why Is Changing a File Different from Changing a Process?**
2. **How Does `changed` Become a Handler Event?**
3. **Why Does One Handler Run for Many Notifications?**
4. **When Should a Service Reload or Restart?**
5. **When Do Handlers Run, and Why Flush Them?**
6. **How Do Validation and `changed_when` Protect Restarts?**
7. **What Happens to Handlers When Tasks Fail?**
8. **How Do You Design a Safe Handler Flow?**

## Why Is Changing a File Different from Changing a Process?
<!-- section-summary: File state and process state have separate lifecycles, so automation must connect a meaningful file change to the correct service action. -->

Even a fully compliant host experiences disruption. The run also reports change every time, making true configuration drift harder to see.

The intended relationship is conditional:

```text
configuration changed
    -> process must react

configuration already correct
    -> process should remain undisturbed
```

Handlers are Ansible's event mechanism for this relationship.

## How Does `changed` Become a Handler Event?
<!-- section-summary: A notifying task queues its handler only when the task reports changed for that host. -->

Attach `notify` to the configuration task:

```yaml
- name: Render Nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
  notify: Restart Nginx

handlers:
  - name: Restart Nginx
    ansible.builtin.service:
      name: nginx
      state: restarted
```

The template module renders candidate content, compares it with the destination, and reports `changed` only if it replaces the file or its managed metadata changes. Ansible queues `Restart Nginx` for that host only on the changed path.

```text
task result = ok
    -> no notification

task result = changed
    -> matching handler becomes pending
```

This is why accurate change reporting is foundational. A task that always reports changed creates false events. A task that incorrectly reports `ok` suppresses a necessary process reaction.

Handlers are better than manually registering the template result and writing `when: config.changed` on a restart task. Notifications declare the dependency next to the change source, several sources can share the reaction, and Ansible handles deduplication and normal handler timing.

A handler is still an ordinary task. It can use modules, variables, privilege escalation, delegation, conditions, and fully qualified collection names. Its special property is how it is scheduled: by notification rather than direct position in the normal task list.

## Why Does One Handler Run for Many Notifications?
<!-- section-summary: Multiple changed tasks can notify one named consequence, which runs once per host at the handler point. -->

A service may read several managed files:

```yaml
- name: Render main Nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
  notify: Restart Nginx

- name: Render application site
  ansible.builtin.template:
    src: app.conf.j2
    dest: /etc/nginx/conf.d/app.conf
  notify: Restart Nginx

- name: Install TLS parameters
  ansible.builtin.copy:
    src: tls.conf
    dest: /etc/nginx/conf.d/tls.conf
  notify: Restart Nginx
```

If all three change, the named handler is pending once. Nginx restarts once rather than after every file:

```text
main config changed -----+
site changed ------------+--> Restart Nginx once
TLS parameters changed --+
```

Deduplication limits disruption and lets all configuration reach disk before the process reloads it. It also makes task order easier to reason about: file operations finish, then the queued consequence runs.

Handler names share a play-level namespace after roles and includes are assembled. A later handler with the same name can shadow another in confusing ways. Use distinctive names or `listen` topics:

```yaml
handlers:
  - name: Reload Nginx configuration
    ansible.builtin.service:
      name: nginx
      state: reloaded
    listen: nginx configuration changed
```

Tasks notify the topic, and one or several handlers can listen. Treat public notification names as role interfaces.

Handler scheduling is per host. If configuration changes on `web01` but not `web02`, only `web01` queues the handler. In a large fleet, accurate change signals prevent a harmless one-host correction from restarting every server.

## When Should a Service Reload or Restart?
<!-- section-summary: Reload asks a capable service to reread configuration with less disruption, while restart stops and starts the process; systemd daemon reload is a separate operation. -->

Choose the consequence the service actually requires.

```yaml
- name: Reload Nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

A reload normally asks the daemon to reread supported configuration while continuing service. A restart stops and starts the process:

```yaml
- name: Restart application
  ansible.builtin.service:
    name: application
    state: restarted
```

Reload can reduce interruption, but only if the daemon supports it and the changed setting takes effect through reload. Some binary, environment, or unit changes require restart. Use service documentation and test the behavior.

`daemon_reload` in the systemd module is different. It asks the systemd manager to reread unit definitions after a unit file or drop-in changes:

```yaml
- name: Reload systemd and restart application
  ansible.builtin.systemd_service:
    name: application
    daemon_reload: true
    state: restarted
```

Systemd daemon reload does not reload the application configuration by itself. It updates systemd's view; `state` then controls the service process. A handler can combine the two when the managed unit file changed.

Choose handler names that describe the exact consequence: `Reload Nginx`, `Restart application`, or `Reload systemd and restart application`. Avoid one vague restart topic shared by unrelated services.

## When Do Handlers Run, and Why Flush Them?
<!-- section-summary: Pending handlers normally run at defined end points, while flush_handlers deliberately applies queued consequences before later work. -->

Handlers normally run after the relevant main task section for a play, not immediately after the notifying task. This allows several changes to accumulate and preserves deduplication.

That timing can be too late when later tasks require the new process state:

```text
render configuration
    -> handler pending
run health check
    -> still testing old process configuration
```

Flush pending handlers first:

```yaml
- name: Apply queued service changes
  ansible.builtin.meta: flush_handlers

- name: Verify local service health
  ansible.builtin.uri:
    url: http://127.0.0.1:8080/health
    status_code: 200
```

`flush_handlers` runs all pending handlers for the affected hosts at that point. It is not scoped only to the task immediately above, so understand every notification already queued.

Role and play boundaries can introduce other handler insertion points, such as after pre-tasks, role tasks, or post-tasks. The practical rule is to know whether downstream work depends on the consequence. Use normal deferred timing when no task needs the restarted state; flush intentionally when validation or orchestration does.

Repeated notifications after a flush can queue the same handler again for a later handler point. A single play can therefore run a handler more than once if changes occur in distinct phases separated by flushes.

## How Do Validation and `changed_when` Protect Restarts?
<!-- section-summary: Validate candidate configuration before installation and make custom commands emit truthful change events so handlers react only to safe, real changes. -->

A handler triggered by an invalid configuration can restart a working service into failure. Many file modules support validation against a temporary candidate:

```yaml
- name: Render validated Nginx configuration
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    validate: /usr/sbin/nginx -t -c %s
  notify: Reload Nginx
```

The module renders a temporary file, substitutes its path for `%s`, runs the validator safely, and replaces the live destination only if validation succeeds. A failed candidate does not notify the handler because the managed file did not change successfully.

Purpose-built modules usually provide accurate `changed`. Custom commands need a contract:

```yaml
- name: Apply routing policy
  ansible.builtin.command: policyctl apply /etc/application/policy.yml
  register: policy_result
  changed_when: "'updated' in policy_result.stdout"
  notify: Reload application
```

If the tool prints `already current`, the task reports `ok` and no handler runs. Also define `failed_when` if the command uses nonstandard exit codes.

Read-only probes should use `changed_when: false`; otherwise they can trigger change-driven logic or make every run appear mutating. Do not set every command to false blindly: a real change must remain observable.

Deterministic templates matter. Timestamps, unordered data, or changing whitespace can rewrite the same logical configuration and fire handlers on every run. Stabilize rendering and test a second run for zero unnecessary change.

## What Happens to Handlers When Tasks Fail?
<!-- section-summary: A later task failure can prevent queued handlers, forced handlers alter that behavior, and neither option creates transaction rollback. -->

Suppose configuration changes and queues a restart, then a later task fails. By default, Ansible may not run the handler on that failed host. The new file can remain on disk while the old process continues using the previous in-memory configuration.

This can be safer than restarting into an incompletely configured system, or it can leave an inconsistent host. The right answer depends on the role's ordering and failure design.

Forced handlers can run notified handlers even after later task failure:

```yaml
- name: Configure service
  hosts: web
  force_handlers: true
```

Use this only when applying the notified consequence is safer than leaving it pending. An unreachable host still cannot run a handler, and a handler can itself fail.

The stronger design validates inputs, writes coherent configuration before notification, and flushes at an intentional point before dependent verification. Blocks and rescue tasks can keep a failed host drained or restore a previous file, but handlers themselves are not transactions.

A restart does not roll back a bad application version. If a handler succeeds and health later fails, recovery needs an explicit previous package, configuration, traffic, or data procedure. Notifications describe consequences of change, not inverse operations.

In fleet rollouts, combine handlers with `serial`. Only hosts whose files change restart, and batches limit simultaneous disruption. Verify each host before the next batch.

## How Do You Design a Safe Handler Flow?
<!-- section-summary: Safe handler design creates truthful events, validates candidates, selects the least disruptive consequence, controls timing, and verifies the service afterward. -->

A complete flow is:

```yaml
---
- name: Configure application service
  hosts: web
  become: true
  serial: 1

  tasks:
    - name: Render validated application configuration
      ansible.builtin.template:
        src: application.yml.j2
        dest: /etc/application/application.yml
        owner: root
        group: application
        mode: "0640"
        validate: /usr/local/bin/application --check-config %s
      notify: Restart application

    - name: Render systemd unit
      ansible.builtin.template:
        src: application.service.j2
        dest: /etc/systemd/system/application.service
        mode: "0644"
      notify: Reload systemd and restart application

    - name: Apply pending process changes
      ansible.builtin.meta: flush_handlers

    - name: Wait for application health
      ansible.builtin.uri:
        url: http://127.0.0.1:8080/health
        status_code: 200
      register: health_result
      retries: 12
      delay: 5
      until: health_result.status == 200
      changed_when: false

  handlers:
    - name: Restart application
      ansible.builtin.service:
        name: application
        state: restarted

    - name: Reload systemd and restart application
      ansible.builtin.systemd_service:
        name: application
        daemon_reload: true
        state: restarted
```

If both templates change, two distinct handlers run because the consequences differ. If neither changes, no process action occurs. Candidate validation prevents an invalid app file from replacing the destination. Flushing ensures the health task sees the new process state. `serial: 1` bounds fleet disruption.

Review handler flows with these questions:

```text
Does the source task report changed accurately?
Is the candidate validated before the event exists?
Is reload sufficient, or is restart required?
Does systemd itself need daemon_reload?
Can several changes share one deduplicated consequence?
When must the consequence occur?
What happens if a later task or the handler fails?
How is actual service health verified?
What explicit recovery restores a bad release?
```

The deepest model is an event pipeline:

```text
observed state differs
    -> state-aware task changes it
    -> truthful changed event
    -> named consequence queued once
    -> handler runs at controlled point
    -> service health proves the new runtime state
```

Well-designed production handlers make operational disruption conditional, deduplicated, explainable, and composable. They are safest when event sources, consequences, timing, and recovery are all explicit.

Handlers also interact with host batching. In a `serial` play, each batch reaches its handler point before the next batch begins. That allows changed hosts in the first batch to restart and pass verification while later hosts remain untouched. A global delegated handler can behave differently, so avoid using an ordinary per-host notification for an action that should happen only once across the entire fleet.

Notifications refer to handler names or listen topics after Ansible inserts handlers from roles and imports. A dynamically included handler is not available until its include is processed, so task organization can affect name resolution. Keep essential handlers in predictable role or play handler sections and use fully descriptive public topics.

Handler ordering follows definition order, not notification order. If tasks notify `Reload systemd` and `Restart application`, define the handlers in the safe sequence. A combined handler is clearer when the actions must be atomic in ordering, while separate listeners are useful when one event legitimately triggers several independent consequences.

Handler task conditions are evaluated when the handler runs. The variables and facts available then may differ from the notifying moment. Avoid registering a short-lived loop result and assuming a shared handler can safely interpret one iteration. Notifications should usually express a stable event such as “application configuration changed.”

Check mode can predict notifications when source modules support change prediction, but the handler normally does not perform the real restart. Review the predicted changed tasks and remember that the service's response remains untested until the canary execution.

Finally, restart safety includes availability outside the host. Drain from traffic before a disruptive handler, flush and verify locally, then restore the host and verify from the load balancer or client boundary. A correct handler solves process reaction; the surrounding rollout solves user continuity.

Use task output from a second canary run as an idempotency check. If templates remain stable, handlers should stay silent. An unexpected restart is operational evidence: find the changing source, nondeterministic render, metadata drift, or false `changed_when` before exposing more hosts to repeated disruption.

Handler behavior should be verified under both single and multiple notifications. Change one managed file, then several files that notify the same listener, and confirm the service action runs once at the intended boundary. Also test an unchanged second run so a noisy upstream task does not silently turn the delayed handler into an unconditional restart.

Choose reload versus restart from the service's real semantics. A reload may preserve connections but ignore options that require a full restart; a restart applies everything but removes capacity. Validate which configuration fields changed, document the supported action, and pair it with the rollout and health checks appropriate to that disruption.

Ansible normally suppresses a notified handler on a host after a later task failure because applying the consequence may be unsafe. `--force-handlers` or `force_handlers: true` changes that behavior. Use it only when the handler is known to move the host toward a safer state even after partial failure; forcing a restart after invalid configuration was written can turn a contained task error into an outage.

## Check Your Answers

:::expand[Why Is Changing a File Different from Changing a Process?]{kind="recap"}
The file can contain new configuration while the daemon still uses old in-memory state. Automation must connect the two without unconditional disruption.
:::

:::expand[How Does `changed` Become a Handler Event?]{kind="recap"}
A notifying task queues its handler only when it reports changed. Accurate module and custom-command change semantics are therefore essential.
:::

:::expand[Why Does One Handler Run for Many Notifications?]{kind="recap"}
Several changed sources can notify one named consequence, which Ansible deduplicates per host at the handler point.
:::

:::expand[When Should a Service Reload or Restart?]{kind="recap"}
Reload is less disruptive when supported; restart recreates the process. Systemd daemon reload only rereads unit definitions and is a separate action.
:::

:::expand[When Do Handlers Run, and Why Flush Them?]{kind="recap"}
Handlers normally run after queued task phases. Flush them when downstream tasks must observe the new runtime state, knowing all pending handlers run.
:::

:::expand[How Do Validation and `changed_when` Protect Restarts?]{kind="recap"}
Validate temporary candidates before replacing live files, and make command tasks report real change so unsafe or unnecessary restarts are not triggered.
:::

:::expand[What Happens to Handlers When Tasks Fail?]{kind="recap"}
Later failures may suppress queued handlers; forced handlers change that choice. Neither behavior supplies rollback, so design coherent ordering and recovery.
:::

:::expand[How Do You Design a Safe Handler Flow?]{kind="recap"}
Combine truthful events, candidate validation, precise reload or restart actions, intentional timing, fleet batching, health checks, and explicit recovery.
:::

---

**References**

- [Ansible: Handlers](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html)
- [Ansible: Defining changed](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_error_handling.html#defining-changed)
- [Ansible: Template module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/template_module.html)
- [Ansible: Service module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/service_module.html)
- [Ansible: systemd_service module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/systemd_service_module.html)
- [Ansible: Error handling and forced handlers](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_error_handling.html)
