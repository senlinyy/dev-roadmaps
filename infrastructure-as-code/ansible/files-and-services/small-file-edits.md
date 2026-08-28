---
title: "Managing Line-Level Edits"
description: "Use lineinfile, blockinfile, and replace when Ansible should manage only part of a file."
overview: "Some files are shared. For those files, Ansible should manage the smallest clear region."
tags: ["ansible", "lineinfile", "blockinfile", "replace"]
order: 2
id: article-infrastructure-as-code-ansible-small-file-edits
aliases:
  - small-file-edits
  - infrastructure-as-code/ansible/files-and-services/small-file-edits.md
---

## Table of Contents

1. [How Much of a Shared File Should Ansible Own?](#how-much-of-a-shared-file-should-ansible-own)
2. [How Does lineinfile Manage One Logical Line?](#how-does-lineinfile-manage-one-logical-line)
3. [How Does blockinfile Own a Marked Section?](#how-does-blockinfile-own-a-marked-section)
4. [When Should replace Perform a Regex Migration?](#when-should-replace-perform-a-regex-migration)
5. [How Do Validation, Check Mode, and Diff Reduce Risk?](#how-do-validation-check-mode-and-diff-reduce-risk)
6. [How Do You Prove a Partial Edit Is Idempotent?](#how-do-you-prove-a-partial-edit-is-idempotent)
7. [What Makes a Small Edit Recoverable?](#what-makes-a-small-edit-recoverable)
8. [How Do the Partial-Edit Tools Fit Together?](#how-do-the-partial-edit-tools-fit-together)
9. [Check Your Answers](#check-your-answers)

The previous article covered files where Ansible owns the whole content. That is the cleanest case because the repository can show the full desired file. Real servers also have shared files, and shared files need a smaller boundary.

![Partial Ownership Boundary](/content-assets/articles/article-infrastructure-as-code-ansible-small-file-edits/partial-ownership-boundary.png)

*The ownership boundary shows how Ansible can manage one setting or one marked block without taking over a whole shared file.*

A shared file is a file where another tool, package, role, or team also owns part of the content. The operating system may ship `/etc/ssh/sshd_config`, a security baseline may manage login policy, and the application team may need one setting for production access. Replacing that whole file with a template can erase context that another owner expects to keep.

Keep these questions in view as you work through the lesson:

1. **How Much of a Shared File Should Ansible Own?**
2. **How Does `lineinfile` Manage One Logical Line?**
3. **How Does `blockinfile` Own a Marked Section?**
4. **When Should `replace` Perform a Regex Migration?**
5. **How Do Validation, Check Mode, and Diff Reduce Risk?**
6. **How Do You Prove a Partial Edit Is Idempotent?**
7. **What Makes a Small Edit Recoverable?**
8. **How Do the Partial-Edit Tools Fit Together?**

## How Much of a Shared File Should Ansible Own?
<!-- section-summary: Partial edit modules let Ansible manage one clear part of a file that has other owners. -->

For the application platform, the web servers need a few small changes outside the app's own files. The platform team wants to set one SSH keepalive value, add one resource-limit block for the `application` service user, and migrate an old metrics endpoint inside a vendor-managed agent file. Those are three different ownership shapes, so Ansible gives us three different tools.

### Choose the Smallest Clear Edit
<!-- section-summary: The module choice follows the ownership boundary before it follows personal preference. -->

The practical question is: **how much of this file does the playbook own?** If the playbook owns one line, use `lineinfile`. If it owns a marked multi-line section, use `blockinfile`. If it needs to replace every occurrence of a known pattern, use `replace`. If the team owns the whole file, go back to `template` or `copy`.

![Edit Tool Choice Map](/content-assets/articles/article-infrastructure-as-code-ansible-small-file-edits/edit-tool-choice-map.png)

*The tool map shows when a single line, managed block, regex replacement, or full template is the right edit boundary.*

That choice keeps playbooks readable. A reviewer can see that a task edits exactly one setting in SSH, exactly one marked block in a limits file, or exactly one old endpoint pattern in a vendor config. The task name should say the same thing in plain language.

Here is the quick mapping we will use:

| Ownership shape | Module | Example in the application fleet |
|---|---|---|
| One key-value line | `ansible.builtin.lineinfile` | Set `ClientAliveInterval` in `sshd_config` |
| One multi-line managed section | `ansible.builtin.blockinfile` | Add `application` limits in `/etc/security/limits.conf` |
| One repeated old pattern | `ansible.builtin.replace` | Move a metrics endpoint in a vendor agent config |
| Whole file | `ansible.builtin.template` or `ansible.builtin.copy` | Own `/etc/nginx/conf.d/application.conf` |

The next sections walk through those small edits with production guardrails around them. Each one keeps the same production rule: change the smallest region with a clear owner.

## How Does `lineinfile` Manage One Logical Line?
<!-- section-summary: lineinfile keeps one matching line present, absent, or replaced. -->

The `ansible.builtin.lineinfile` module manages one line in a text file. It can ensure a line exists, remove a line, or replace the line that matches a regular expression. It fits files where one setting has one obvious key.

A **regular expression** is a search pattern. In these tasks, the regex should find the old version of the line and the final version of the line. That lets the second run find the managed setting again and report `ok` instead of appending a duplicate line.

In the application fleet, the operations team wants SSH sessions to close stale connections after a reasonable idle period. The operating system and security baseline still own most of `sshd_config`, so the playbook manages only the keepalive line.

```yaml
- name: Set SSH client keepalive interval for operations sessions
  ansible.builtin.lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^#?\s*ClientAliveInterval\s+'
    line: 'ClientAliveInterval 300'
    backup: true
    validate: /usr/sbin/sshd -t -f %s
  notify: Reload SSH
```

The `regexp` looks for an active or commented `ClientAliveInterval` line. The `line` gives the final desired line. The validation command asks SSH to parse the temporary candidate file before Ansible replaces the live config, so a typo fails early.

A good `regexp` is specific enough to find only the setting you own. Anchoring with `^` avoids matching examples in the middle of comments. Including the key name and expected spacing makes the edit repeatable. The task should report `changed` on the first run and `ok` on the next run when the file already contains the desired line.

## How Does `blockinfile` Own a Marked Section?
<!-- section-summary: blockinfile owns a multi-line block surrounded by stable marker lines. -->

The `ansible.builtin.blockinfile` module manages a block of text inside marker lines. It fits a file where Ansible owns several related lines, while the rest of the file stays under another owner. The markers are important because they show humans and Ansible where the managed section starts and ends.

For the application service, the team wants higher file descriptor limits for the `application` user. The OS package baseline and security baseline own most of `/etc/security/limits.conf`, so the playbook adds one marked section.

```yaml
- name: Manage application service limits
  ansible.builtin.blockinfile:
    path: /etc/security/limits.conf
    marker: '# {mark} ANSIBLE MANAGED APPLICATION SERVICE LIMITS'
    block: |
      application soft nofile 65535
      application hard nofile 65535
    backup: true
  notify: Restart application API
```

The marker text should be stable and descriptive. Later runs use it to find the existing block and update it in place. Future readers can also see that the block belongs to automation, which lowers the chance of someone editing the managed section during a production incident.

Blocks work well for small, clearly owned sections. When the managed block grows into most of the file, the team should reconsider full-file ownership with a template. A giant block inside a shared file can hide the real desired state across tasks and make reviews slow and confusing.

## When Should `replace` Perform a Regex Migration?
<!-- section-summary: replace changes every regex match, so the pattern needs careful scope and review. -->

The `ansible.builtin.replace` module replaces every match of a regular expression in a file. It fits migrations where a known old value may appear in more than one line, such as a deprecated path, hostname, socket location, or feature flag. The module uses Python regular expressions, so it can be precise when the pattern is written carefully.

In the application fleet, a vendor monitoring agent still points at the old metrics gateway on a few hosts. The agent owns the rest of the config file, and the platform team only wants to move the endpoint.

```yaml
- name: Move application metrics endpoint to the v2 gateway
  ansible.builtin.replace:
    path: /etc/vendor-agent/agent.conf
    regexp: 'http://metrics-v1\.internal:9090'
    replace: 'http://metrics-v2.internal:9090'
    backup: true
  notify: Restart vendor agent
```

This pattern matches the old endpoint only. The dots are escaped because a dot in a regex means any character. The replacement is the new endpoint, and the task reports `ok` after the old value disappears.

Broad regex patterns create production surprises. A pattern like `metrics.*9090` could touch comments, examples, or unrelated URLs. A precise pattern includes the exact old value, and a staging diff shows every line that will change before production.

Regex editing is a poor fit for structured files such as YAML, JSON, TOML, and many application config formats when the team owns the whole file. Those files usually belong in a template or a purpose-built module because whitespace, quoting, nesting, and repeated keys can make line-based edits misleading. Use `replace` when the ownership boundary is truly a known text pattern inside someone else's file.

## How Do Validation, Check Mode, and Diff Reduce Risk?
<!-- section-summary: Preview the exact line or block before writing it to make a partial edit safer. -->

Partial edits deserve the same review path as full-file templates. Check mode predicts whether the task would change the host, and diff mode shows the line, block, or regex replacement when the module supports diff output. This is especially useful for shared files because each host may have a slightly different starting point.

```bash
ansible-playbook -i inventories/staging application-shared-files.yml --limit application-web-stg-01 --check --diff
ansible-playbook -i inventories/staging application-shared-files.yml --limit application-web-stg-01
```

For file formats with a parser, add `validate`. SSH config, sudoers, many application configs, and several service tools can validate a candidate file. The validation command should accept the temporary `%s` file directly, or a wrapper script should perform the more complex check.

```yaml
- name: Add sudo rule for application deployment user
  ansible.builtin.lineinfile:
    path: /etc/sudoers.d/application-deploy
    line: 'application-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart application'
    create: true
    owner: root
    group: root
    mode: "0440"
    validate: /usr/sbin/visudo -cf %s
    backup: true
```

Diff mode and secret handling need a careful boundary. A diff for `sshd_config` is usually fine. A diff for a file containing tokens or private values can leak those values into CI logs. For secret-bearing files, teams normally use `no_log: true`, Ansible Vault, and a staging verification command that avoids printing the secret.

## How Do You Prove a Partial Edit Is Idempotent?
<!-- section-summary: Reliable partial edits report changed once, then ok, and failures usually point to patterns, validation, or file ownership. -->

**Idempotency** means a task can run repeatedly and keep the same final state without changing the host every time. Partial edit tasks should usually report `changed` on the first real run and `ok` on the second run. When they report `changed` every run, the pattern and replacement probably disagree with each other.

For `lineinfile`, the `regexp` should match the current wrong state and the final right state. The keepalive regex matches `ClientAliveInterval 300` after replacement, so later runs find the line and leave it alone. For `replace`, the pattern should match the old text and disappear after the replacement. For `blockinfile`, the marker should stay stable so Ansible can find the block again.

Here are useful verification commands after a staging run:

```bash
ansible -i inventories/staging web -m ansible.builtin.command -a "sshd -T | grep clientaliveinterval"
ansible -i inventories/staging web -m ansible.builtin.command -a "grep -n 'ANSIBLE MANAGED APPLICATION SERVICE LIMITS' /etc/security/limits.conf"
ansible -i inventories/staging web -m ansible.builtin.command -a "grep -n 'metrics-v2.internal' /etc/vendor-agent/agent.conf"
```

Failure messages often map to one of three causes. A validation failure means the candidate file would break the service parser. A missing file failure means the task needs `create: true` or the team chose the wrong ownership boundary. A changed-every-run result means the regex, marker, or replacement needs a tighter shape.

## What Makes a Small Edit Recoverable?
<!-- section-summary: Backups, small limits, service validation, and Git rollback keep shared-file edits recoverable. -->

Partial edits can affect files that operators rely on during emergencies, so rollback needs to be simple. `backup: true` gives a timestamped copy before the edit. Git gives the reviewed source of truth. A small production limit lets the team watch one host before touching the whole fleet.

```bash
ansible-playbook -i inventories/production application-shared-files.yml --limit application-web-prod-01 --diff
ansible-playbook -i inventories/production application-shared-files.yml --limit web --forks 2
```

If SSH validation fails, the live file stays in place and the handler remains unqueued. If a bad edit passes validation and causes an operational issue, restore the backup on the affected host, reload the service, and then fix or revert the playbook source so the next run matches the intended state.

```bash
sudo cp /etc/ssh/sshd_config.12345.2026-06-13@12:30:42~ /etc/ssh/sshd_config
sudo sshd -t -f /etc/ssh/sshd_config
sudo systemctl reload sshd
```

The manual restore is the emergency step. The durable rollback is a commit that returns the automation to the desired content, followed by a normal Ansible run. That keeps the shared file from drifting again during the next deployment.

## How Do the Partial-Edit Tools Fit Together?
<!-- section-summary: lineinfile, blockinfile, and replace keep automation precise when files have multiple owners. -->

The application web fleet now has a clear partial-edit approach. `lineinfile` owns one SSH keepalive line. `blockinfile` owns one marked limits section for the service user. `replace` moves one old metrics endpoint across the vendor agent file. Each task has a tight ownership boundary, and risky files use validation or backups.


![Small Edits Summary](/content-assets/articles/article-infrastructure-as-code-ansible-small-file-edits/small-edits-summary.png)

*The summary turns small-file edits into a safe sequence: choose the smallest tool, guard the regex, validate, read the diff, and roll back.*

The operator workflow mirrors full-file management. Preview with `--check --diff`, run in staging, verify the parser and resulting content, then roll through production in small batches. A task that reports `ok` on the second run gives you confidence that the edit is repeatable.

Those file changes often need service actions after they land. The next article connects changed tasks to handlers, reloads, restarts, health checks, and rollback behavior.

Several details keep the modules honest. With `lineinfile`, matching and placement are different decisions. `regexp` or `search_string` identifies an existing logical line; `insertbefore` and `insertafter` decide where a missing line is created. `state: absent` removes matching lines. Test commented defaults and the final desired line so a second run finds what the first run wrote instead of appending a duplicate.

With `blockinfile`, markers are the managed block's identity. Different blocks in one file require distinct, stable marker text. Changing a marker can leave the old block in place and add another. Positioning can place the marked section near a stable heading, while `state: absent` removes that identified region without taking ownership of surrounding content.

With `replace`, idempotence belongs to the pattern design. The replacement should normally stop matching the legacy expression. Capture groups can preserve context while changing one field. `before` and `after` can bound the transformation to a section when the same token appears elsewhere. These are scope controls, not substitutes for inspecting every diff.

Backups and rollback solve different problems. `backup: true` preserves a prior file on the managed host, which can speed emergency recovery. The backup may contain confidential content and needs restrictive access and retention. Durable rollback updates or reverts the reviewed automation, reruns it against the affected scope, and verifies the service so the next normal run does not recreate the incident.

Prove partial-edit behavior with a small matrix: legacy line present, commented default present, final state already present, no match, and multiple matches. The first applicable run should show the exact intended diff. The second run should report `ok` and leave handlers silent. Zero or multiple matches should be accepted only when the ownership contract explicitly permits them.

### What Comes Next?

The next article covers handlers and restarts. Once a template, line edit, block edit, or replacement changes a service input, Ansible needs a clean way to run the service action once and only when the input changed.

Shared-file edits also need collision testing. Apply the role beside package defaults and another known manager in staging, upgrade the package, and rerun Ansible. The test should prove the marker, line, or replacement survives legitimate surrounding changes without duplicating content or claiming a broader section than intended.

Validation should parse the candidate, not merely confirm that text exists. For an application supporting a configuration check, a task can pass Ansible's temporary `%s` path to a command such as `myapp --check-config %s`. Ansible installs the candidate only after that command succeeds. Because validation does not run through a shell, pipes and `&&` are not interpreted unless a separate wrapper deliberately provides that behavior.

## Check Your Answers

:::expand[How Much of a Shared File Should Ansible Own?]{kind="recap"}
Choose the smallest explicit boundary: one line, one marked block, one text transformation, or the complete file.
:::

:::expand[How Does `lineinfile` Manage One Logical Line?]{kind="recap"}
Match the owned setting and declare its final line or absence; treat matching and insertion position separately.
:::

:::expand[How Does `blockinfile` Own a Marked Section?]{kind="recap"}
Stable unique markers identify a multi-line region across updates and removal without replacing surrounding shared content.
:::

:::expand[When Should `replace` Perform a Regex Migration?]{kind="recap"}
Use it for a bounded transformation whose output stops matching the old pattern, with captures and region limits when needed.
:::

:::expand[How Do Validation, Check Mode, and Diff Reduce Risk?]{kind="recap"}
Validate temporary candidates, preview supported changes, inspect exact diffs, and protect secret-bearing output before live edits.
:::

:::expand[How Do You Prove a Partial Edit Is Idempotent?]{kind="recap"}
Test match edge cases and run twice; the compliant second run should produce neither file change nor handler notification.
:::

:::expand[What Makes a Small Edit Recoverable?]{kind="recap"}
Combine narrow rollout, validation, protected backups, service checks, and source reconciliation instead of relying on backups alone.
:::

:::expand[How Do the Partial-Edit Tools Fit Together?]{kind="recap"}
Match the tool to ownership, tightly bound its reach, prove its diff and idempotence, then trigger process consequences only after real change.
:::

---

**References**

- [ansible.builtin.lineinfile](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/lineinfile_module.html) - Official module documentation for managing a single line in a text file.
- [ansible.builtin.blockinfile](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/blockinfile_module.html) - Official module documentation for managing marked multi-line blocks.
- [ansible.builtin.replace](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/replace_module.html) - Official module documentation for regex-based replacements.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official playbook guide for previewing and reviewing changes.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official guide for running service actions after changed tasks.
