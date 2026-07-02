---
title: "Reading Playbook Output"
description: "Read Ansible output as per-host evidence about what ran, what changed, and what failed."
overview: "Understand the stdout streams and recap blocks of playbook runs, separate connection drops from task failures, and decode execution metadata."
tags: ["ansible", "results", "recap"]
order: 4
id: article-infrastructure-as-code-ansible-reading-run-results
aliases:
  - playbooks-and-tasks/reading-run-results.md
  - infrastructure-as-code/ansible/playbooks-and-tasks/reading-run-results.md
---

## Table of Contents

1. [Output Is Deployment Evidence](#output-is-deployment-evidence)
2. [Status Words in Task Output](#status-words-in-task-output)
3. [Failed and Unreachable Mean Different Repairs](#failed-and-unreachable-mean-different-repairs)
4. [Registered Results, Verbosity, and Diffs](#registered-results-verbosity-and-diffs)
5. [Reading the Play Recap](#reading-the-play-recap)
6. [A Production Debugging Walkthrough](#a-production-debugging-walkthrough)
7. [Rollback, Audit, and Safety](#rollback-audit-and-safety)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## Output Is Deployment Evidence
<!-- section-summary: Ansible output records which tasks ran on which hosts and what each host reported back. -->

Ansible output is the evidence trail for a run. It tells you which play started, which task ran, which host reported a result, which host changed, and which host failed or became unreachable. A beginner can read it as a conversation between the control node and every managed host.

Keep the orders platform in mind. A production deploy targets two web hosts, `orders-web-01` and `orders-web-02`. The playbook renders an API config, validates it, restarts the service through a handler, and checks the health endpoint. One host may change, the other may already be current, and a third host in a larger fleet may fail before Ansible can connect.

Readable output depends on practical playbook habits. Clear task names make the log readable. Idempotent tasks make `changed` meaningful. Validation tasks with `changed_when: false` keep read-only checks quiet. With those habits in place, the output acts as a practical deployment record.

## Status Words in Task Output
<!-- section-summary: Each task result uses a small set of status words that point to a specific host-level outcome. -->

Ansible prints a status word for each task and host. These words are short and they carry a lot of operational meaning.


![Status Word Map](/content-assets/articles/article-infrastructure-as-code-ansible-reading-run-results/status-word-map.png)

*The status map makes Ansible output easier to scan by separating ok, changed, failed, unreachable, skipped, and rescued signals.*

| Status | Meaning during an orders deploy |
|---|---|
| `ok` | The task completed with no reported change for that host. |
| `changed` | The task completed and reported that it moved the host state. |
| `skipping` | A condition, tag, or check-mode rule skipped the task for that host. |
| `failed` | Ansible reached the host, and the module or command reported failure. |
| `unreachable` | The connection path to the host failed. |
| `rescued` | A task failed inside a block, and a rescue section handled it. |
| `ignored` | A task failed, and the play continued because the task allowed that failure. |

Here is a small slice of output from the orders API play. One host changes and the other host stays current.

```
TASK [Render orders API configuration] ***************************************
changed: [orders-web-01.example.com]
ok: [orders-web-02.example.com]

RUNNING HANDLER [Restart orders API] *****************************************
changed: [orders-web-01.example.com]
```

This says the rendered config differed on `orders-web-01`, so Ansible wrote the file there and notified the handler. The same template already matched `orders-web-02`, so that host stayed quiet for this task. The handler ran for the host that needed it.

Now compare that to this validation task. It still ran, and it reports a read-only result.

```
TASK [Validate orders API configuration] *************************************
ok: [orders-web-01.example.com]
ok: [orders-web-02.example.com]
```

The validation command may have executed on both hosts. `changed_when: false` kept it from counting as a change. That is the right signal for a read-only check because it tells the operator that validation passed without pretending the machine moved.

## Failed and Unreachable Mean Different Repairs
<!-- section-summary: A failed task reached the host, while an unreachable host failed before useful task execution could happen. -->

The most important output split is `failed` versus `unreachable`. A **failed** task reached the managed host and then the module or command returned a failure. An **unreachable** host failed before Ansible had a usable connection to the host.


![Failure Repair Split](/content-assets/articles/article-infrastructure-as-code-ansible-reading-run-results/failure-repair-split.png)

*The repair split shows why failed usually points at task logic, while unreachable points first at network, SSH, DNS, or credentials.*

For example, this is a task failure. The host was reachable, so the failed task is the evidence.

```
TASK [Validate orders API configuration] *************************************
fatal: [orders-web-01.example.com]: FAILED! => {"changed": false, "cmd": "orders-api --check-config /etc/orders-api/config.yml", "rc": 1}
```

The host was reachable. Ansible ran the validation command. The command returned a failing result. The next step is to read the command output, inspect the rendered config, and fix the value or template that produced invalid application configuration.

This is a reachability failure. The host missed the play before useful task work could happen.

```
TASK [Gathering Facts] *******************************************************
fatal: [orders-web-02.example.com]: UNREACHABLE! => {"changed": false, "msg": "Failed to connect to the host via ssh"}
```

The connection path is the first suspect here. The operator should check DNS, inventory hostnames, SSH keys, bastion access, host keys, network ACLs, and the remote user. Ansible removed the host from active execution for the run, so later tasks left it untouched.

This distinction matters during incident calls. If `orders-web-02` is unreachable, the team should keep that host out of the completed-deploy count. If `orders-web-01` failed validation, the team should inspect the application config path and the variables that produced it.

## Registered Results, Verbosity, and Diffs
<!-- section-summary: Registered variables and verbosity give deeper evidence, while diff output needs care around secrets. -->

A task can save its result with `register`. The saved result belongs to the current host and can include fields such as `changed`, `failed`, `rc`, `stdout`, `stderr`, `status`, `content`, and module-specific data. Later tasks can branch from that result.

The shape depends on the module, but a few fields appear often:

| Field | What it usually means |
|---|---|
| `changed` | Whether the task reported a state change. |
| `failed` | Whether the task result is a failure. |
| `rc` | Return code from command-like modules. |
| `stdout` / `stderr` | Text printed by a command. |
| `status` | HTTP status from modules such as `uri`. |
| `skipped` | Whether a condition, tag, or check-mode rule skipped the task. |
| `results` | Per-item results when a task runs in a loop. |

When a later task checks this data, use fields with a stable contract. HTTP status codes, documented return codes, and JSON fields usually age better than a sentence printed for humans.

```yaml
- name: Check orders API health
  ansible.builtin.uri:
    url: http://127.0.0.1:8080/health
    return_content: true
  register: orders_health
  changed_when: false

- name: Stop when orders API health check fails
  ansible.builtin.fail:
    msg: "orders API health check returned {{ orders_health.status }}"
  when: orders_health.status != 200
```

During development, a debug task can show the shape of a registered result. This is useful when you need to know whether a module returns `status`, `json`, `stdout`, or another field. It should be removed or guarded before normal production use if the result can contain secrets.

```yaml
- name: Show orders API health result during troubleshooting
  ansible.builtin.debug:
    var: orders_health
  when: orders_debug_output | default(false)
```

Verbosity flags can show more detail from the command line. A normal run keeps output compact. A troubleshooting run can add `-v` or `-vv` to expose more execution detail. Higher verbosity can include sensitive module arguments, connection detail, or command output, so CI logs and controller job output should be treated as records that may need retention controls.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com -vv
```

Diff mode adds another kind of evidence. For template and file work, `--diff` can show before-and-after content. That is excellent for reviewing a candidate config on a canary host. It can also reveal secrets if the file contains credentials, so tasks that handle sensitive files should use `diff: false` or `no_log: true` where appropriate.

Check mode can change the result story. A task that normally registers a value might skip in check mode if the module cannot predict safely, and a later task may not have the data it expects. A preview that shows skipped registered data should lower confidence for that branch. The canary apply then gives the evidence that proves the branch for real.

## Reading the Play Recap
<!-- section-summary: The recap condenses the whole run into per-host counters that show participation, change, failure, and skips. -->

At the end of a playbook run, Ansible prints a **play recap**. The recap gives a fast per-host summary while the task output carries the detailed evidence. It is the first place many operators look after a deploy finishes.

```
PLAY RECAP *******************************************************************
orders-web-01.example.com : ok=18 changed=3 unreachable=0 failed=0 skipped=4 rescued=0 ignored=0
orders-web-02.example.com : ok=17 changed=0 unreachable=0 failed=0 skipped=4 rescued=0 ignored=0
orders-web-03.example.com : ok=0  changed=0 unreachable=1 failed=0 skipped=0 rescued=0 ignored=0
```

This recap tells three different stories. `orders-web-01` received changes and completed successfully. `orders-web-02` participated and already matched the desired state. `orders-web-03` missed the run because reachability failed.

The counters should match the team's intent. During a canary release, one changed host may be expected. During a second idempotency run, `changed=0` is usually the expected result. During a production-wide deploy, `unreachable=1` means one host missed the change and needs a separate decision: repair and rerun, remove from service, or document why it was excluded.

The `ansible-playbook` command returns a nonzero exit code when the run has failures or unreachable hosts. That behavior lets CI jobs and controller workflows stop a pipeline instead of hiding a bad deploy behind a green result.

## A Production Debugging Walkthrough
<!-- section-summary: A useful debugging path starts from the failed host and task, then follows the layer that produced that status. -->

Suppose the orders API deploy shows this sequence. The order of the two tasks gives enough information to choose the next step.

```
TASK [Render orders API configuration] ***************************************
changed: [orders-web-01.example.com]
changed: [orders-web-02.example.com]

TASK [Validate orders API configuration] *************************************
ok: [orders-web-01.example.com]
fatal: [orders-web-02.example.com]: FAILED! => {"changed": false, "rc": 1}
```

The first task changed both hosts, so both received a new config file. The second task says one host passed validation and one host failed validation. The failure happened after the file write and before the handler restart. That means `orders-web-02` may now have a new config file on disk while the service still runs the previous process.

A careful follow-up gathers evidence from that host. The operator can rerun the validation task with more verbosity, inspect the rendered config, or run a targeted command task. The rollback path should use the same playbook with the previous known-good variables or repository version.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-02.example.com --start-at-task "Validate orders API configuration" -vv
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-02.example.com -e orders_api_release=2026.06.12
```

Handler behavior also matters in this situation. By default, a later task failure can prevent an earlier notified handler from running for that host. Ansible supports `--force-handlers` and `force_handlers` when the team decides that already-notified handlers must run even after later failures. That setting should be a deliberate operational choice because restarting into a bad config can make the incident worse.

## Rollback, Audit, and Safety
<!-- section-summary: Playbook output should help the team decide whether to widen, pause, repair, or roll back a change. -->

Output reading should lead to a decision. If the canary changed the expected tasks and health checks passed, the team can widen the run. If the canary changed unexpected tasks, the team should pause and inspect the diff. If a task failed after writing a file, the team should decide whether to roll back the file, repair the value, or keep the host out of service.

For audit, keep the command line, inventory, Git commit, extra variables, and output together. In a controller, that record may live as a job run. In a CLI workflow, teams often store the pipeline log and release metadata. The important part is being able to answer what ran, who triggered it, which hosts changed, and which hosts failed or skipped.

Secrets deserve special handling. Verbose logs, debug tasks, and diff output can persist in CI artifacts or controller history. Sensitive values should use Ansible Vault or another secret source, and tasks that might print secrets should use `no_log: true` or avoid debug output.

A safe production log should prove the run without printing private data. It can show the commit, inventory, selected hosts, task names, changed counts, health-check status, and rollback target. It should avoid raw secret values, full private config diffs, and debug dumps of registered results from secret-bearing tasks.

Rollback should follow the same audited path as rollout. If the bad change was a template or variable edit, revert the repository change and run the playbook against the affected host first. If the bad change was a release input, restore the previous release value and run a canary command. The recap from the rollback run gives the evidence that the host returned to the desired state.

## Putting It All Together
<!-- section-summary: Reading output well turns playbook runs into a practical record of host state, change, failure, and follow-up work. -->

The orders platform deploy now has readable output. Task names explain the work. `ok` means the host already matched or the read-only check passed. `changed` means the host moved. `failed` means a task reached the host and failed there. `unreachable` means the connection layer needs attention before playbook logic can matter.


![Run Results Summary](/content-assets/articles/article-infrastructure-as-code-ansible-reading-run-results/run-results-summary.png)

*The summary turns playbook output into evidence: output, recap, diff, registered data, and audit trail.*

Registered results and verbosity give deeper evidence during debugging. Diff mode helps review file changes, with care around secrets. The recap gives the final per-host story and helps CI or controller workflows make a pass-or-fail decision.

The next group turns from output to input. Variables let one playbook use different values for staging, production, hosts, roles, and release events.

## What's Next

The next article starts the values and facts section with variables. It uses the same orders platform to show where values live, how templates consume them, and how runtime overrides fit into a real deployment.

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Official description of playbook output, task execution, summaries, failures, and unreachable counts.
- [Return Values](https://docs.ansible.com/projects/ansible/latest/reference_appendices/common_return_values.html) - Official reference for common registered result fields such as `changed`, `failed`, `rc`, `stdout`, `stderr`, and `skipped`.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guidance for failures, unreachable hosts, handlers after failure, `failed_when`, `changed_when`, and rescue behavior.
- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html) - Official examples for conditions based on facts, variables, and registered variables.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official details for check mode, diff mode, and sensitive diff handling.
- [ansible.builtin.debug](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/debug_module.html) - Official module reference for printing variables during troubleshooting.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for verbosity, limits, `--start-at-task`, check mode, diff mode, and execution behavior.
