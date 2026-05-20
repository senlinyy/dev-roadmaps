---
title: "Reading Run Results"
description: "Read Ansible output as per-host evidence about what ran, what changed, and what failed."
overview: "Ansible output is the feedback loop for a playbook run."
tags: ["ansible", "results", "recap"]
order: 4
id: article-infrastructure-as-code-ansible-reading-run-results
---

## Table of Contents

1. [Why Results Matter](#why-results-matter)
2. [Per-Host Evidence](#per-host-evidence)
3. [OK and Changed](#ok-and-changed)
4. [Failed and Unreachable](#failed-and-unreachable)
5. [Skipped, Rescued, and Ignored](#skipped-rescued-and-ignored)
6. [The Recap](#the-recap)
7. [Where Results Mislead](#where-results-mislead)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Results Matter

Ansible output is the evidence trail for a run. It tells you which task ran, which host produced the result, whether the task changed that host, and whether the host can continue.

This matters because playbooks usually target groups, not one machine. The same orders task can install Nginx on one host, report `ok` on another host, and fail on a third host. Reading the output well means you do not flatten those different host stories into one vague pass or fail.

Clear output starts before the run begins. The task name becomes the label in the output. A task named `Render orders site config` gives useful information. A task named `Do thing` makes the output hard to use when time is short.

## Per-Host Evidence

Ansible reports task results per host. This short output says one task reached two orders web hosts and found different states:

```text
TASK [Install nginx]
changed: [orders-web-02]
ok: [orders-web-01]
```

The task was the same. The result differed because the hosts differed. `orders-web-02` needed a package installed. `orders-web-01` already had it.

This per-host shape continues through the whole run. If `orders-web-02` later fails during a template task, Ansible can stop running later tasks on that host while continuing with `orders-web-01`. The output is both a timeline and a map of host state.

## OK and Changed

`ok` means the task ran and did not change the host. For a state-aware task, this usually means the host already matched the requested state.

`changed` means the task ran and changed the host, or the task was told to report change. Both can be healthy. A fresh host should show changes. A settled host should show mostly `ok`. A deployment that edits the orders Nginx template should show change on the template task.

The useful question is whether the change matches the work. In this output, the template change is expected because a new config was deployed:

```text
TASK [Render orders site config]
changed: [orders-web-01]
changed: [orders-web-02]

RUNNING HANDLER [Reload nginx]
changed: [orders-web-01]
changed: [orders-web-02]
```

The handler ran because the template task reported change. If that same handler runs on every playbook run with no template edits, the change result is probably too broad.

## Failed and Unreachable

`failed` and `unreachable` are different problems.

`unreachable` means Ansible could not connect to the host. The task did not really get a chance to run:

```text
fatal: [orders-web-02]: UNREACHABLE! => {
    "msg": "Failed to connect to the host via ssh"
}
```

For an unreachable host, check the inventory address, SSH user, SSH key, DNS, VPN, firewall rules, bastion access, and whether the host is running.

`failed` means Ansible reached the host, ran the task or module, and the task did not complete successfully:

```text
fatal: [orders-web-01]: FAILED! => {
    "msg": "Destination directory /etc/nginx/conf.d does not exist"
}
```

For a failed task, start with the module arguments and the host state. In this example, the fix may be to install Nginx first, create the directory, or correct the destination path.

The practical surprise is that these statuses affect the rest of the run. By default, a host with a failed task stops running later tasks in that play. A host marked unreachable is also removed from the active set. Other hosts can continue.

## Skipped, Rescued, and Ignored

`skipped` usually means a condition evaluated to false. The task was considered, but Ansible decided it should not run for that host.

An orders playbook may install packages differently by operating system family:

```yaml
- name: Install nginx on Debian hosts
  ansible.builtin.apt:
    name: nginx
    state: present
  when: ansible_facts["os_family"] == "Debian"
```

On a Red Hat family host, that task is skipped because the condition is false. A skipped task can be healthy if the condition is expected. It can also reveal that facts were missing or a variable had an unexpected value.

`rescued` appears when a task fails inside a block and a rescue section handles the failure. This is useful for controlled recovery, but it should still be read carefully. The original task failed; the playbook had a planned path for what to do next.

`ignored` means a task failed but the play continued because the playbook told Ansible to ignore the error. Ignored failures are easy to forget because the run may still complete. Use them sparingly and name the task clearly so the output explains why the failure was acceptable.

## The Recap

The recap at the bottom summarizes each host:

```text
PLAY RECAP
orders-web-01 : ok=14 changed=2 unreachable=0 failed=0 skipped=1 rescued=0 ignored=0
orders-web-02 : ok=8  changed=1 unreachable=0 failed=1 skipped=1 rescued=0 ignored=0
```

Read the recap as a per-host health table.

| Field | Meaning |
|-------|---------|
| `ok` | Tasks completed without changing the host |
| `changed` | Tasks reported a host change |
| `unreachable` | Ansible could not connect to the host |
| `failed` | Tasks failed after Ansible reached the host |
| `skipped` | Tasks were skipped by conditions or other control flow |
| `rescued` | Failures were handled by rescue blocks |
| `ignored` | Failures were ignored by playbook settings |

In the example recap, `orders-web-01` completed cleanly. `orders-web-02` had one failed task. Even though some tasks were `ok` and one task changed, the host still needs attention because `failed=1`.

## Where Results Mislead

Ansible output is useful, but it is only as accurate as the tasks make it.

A command task can report `changed` every run even when it only checks health. Add `changed_when: false` when the command is read-only:

```yaml
- name: Check orders API health
  ansible.builtin.command: curl -fsS http://127.0.0.1:3000/health
  register: orders_health
  changed_when: false
```

A command can also return a non-zero code for a result you expect. In that case, define failure with `failed_when` instead of hiding every error:

```yaml
- name: Look for optional orders maintenance flag
  ansible.builtin.command: test -f /etc/orders-api/maintenance.flag
  register: maintenance_flag
  changed_when: false
  failed_when: maintenance_flag.rc not in [0, 1]
```

Here `rc=0` means the flag exists and `rc=1` means it does not. Both are valid observations. Any other return code is treated as failure.

The other common source of confusion is verbosity. Normal output is intentionally short. When a module failure message is not enough, rerun with more verbosity or add a focused `debug` task while troubleshooting. Remove broad debug output when the lesson is learned, especially if values could contain secrets.

## Putting It All Together

For the orders service, a good Ansible run tells a clear story:

- The task names say what the playbook tried to manage.
- Each host reports its own result for each task.
- `ok` and `changed` show whether the host already matched or needed work.
- `failed` and `unreachable` separate task problems from connection problems.
- The recap shows which hosts are clean and which hosts need attention.

This output is the feedback loop for idempotency. A settled orders host should become quieter on later runs. When it does not, the task result points you toward the part of the playbook that needs inspection.

## What's Next

The next group moves from playbook structure into values and facts. Playbooks become much more useful when the same task can read different service ports, host names, package names, and operating system facts without copying the whole task list.

---

**References**

- [Ansible playbooks: playbook execution](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html#playbook-execution)
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html)
- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html)
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html)
