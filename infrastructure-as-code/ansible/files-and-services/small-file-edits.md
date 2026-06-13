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

1. [Partial Ownership of Shared Files](#partial-ownership-of-shared-files)
2. [Choosing the Smallest Edit](#choosing-the-smallest-edit)
3. [One Setting with lineinfile](#one-setting-with-lineinfile)
4. [One Managed Section with blockinfile](#one-managed-section-with-blockinfile)
5. [Regex Migrations with replace](#regex-migrations-with-replace)
6. [Validation, Check Mode, and Diff Mode](#validation-check-mode-and-diff-mode)
7. [Failure Reading and Idempotency](#failure-reading-and-idempotency)
8. [Rollback and Safety](#rollback-and-safety)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Partial Ownership of Shared Files
<!-- section-summary: Partial edit modules let Ansible manage one clear part of a file that has other owners. -->

The previous article covered files where Ansible owns the whole content. That is the cleanest case because the repository can show the full desired file. Real servers also have shared files, and shared files need a smaller boundary.

A shared file is a file where another tool, package, role, or team also owns part of the content. The operating system may ship `/etc/ssh/sshd_config`, a security baseline may manage login policy, and the application team may need one setting for production access. Replacing that whole file with a template can erase context that another owner expects to keep.

For the orders platform, the web servers need a few small changes outside the app's own files. The platform team wants to set one SSH keepalive value, add one resource-limit block for the `orders` service user, and migrate an old metrics endpoint inside a vendor-managed agent file. Those are three different ownership shapes, so Ansible gives us three different tools.

## Choosing the Smallest Edit
<!-- section-summary: The module choice follows the ownership boundary before it follows personal preference. -->

The practical question is: **how much of this file does the playbook own?** If the playbook owns one line, use `lineinfile`. If it owns a marked multi-line section, use `blockinfile`. If it needs to replace every occurrence of a known pattern, use `replace`. If the team owns the whole file, go back to `template` or `copy`.

That choice keeps playbooks readable. A reviewer can see that a task edits exactly one setting in SSH, exactly one marked block in a limits file, or exactly one old endpoint pattern in a vendor config. The task name should say the same thing in plain language.

Here is the quick mapping we will use:

| Ownership shape | Module | Example in the orders fleet |
|---|---|---|
| One key-value line | `ansible.builtin.lineinfile` | Set `ClientAliveInterval` in `sshd_config` |
| One multi-line managed section | `ansible.builtin.blockinfile` | Add `orders` limits in `/etc/security/limits.conf` |
| One repeated old pattern | `ansible.builtin.replace` | Move a metrics endpoint in a vendor agent config |
| Whole file | `ansible.builtin.template` or `ansible.builtin.copy` | Own `/etc/nginx/conf.d/orders-api.conf` |

The next sections walk through those small edits with production guardrails around them. Each one keeps the same production rule: change the smallest region with a clear owner.

## One Setting with lineinfile
<!-- section-summary: lineinfile keeps one matching line present, absent, or replaced. -->

The `ansible.builtin.lineinfile` module manages one line in a text file. It can ensure a line exists, remove a line, or replace the line that matches a regular expression. It fits files where one setting has one obvious key.

A **regular expression** is a search pattern. In these tasks, the regex should find the old version of the line and the final version of the line. That lets the second run find the managed setting again and report `ok` instead of appending a duplicate line.

In the orders fleet, the operations team wants SSH sessions to close stale connections after a reasonable idle period. The operating system and security baseline still own most of `sshd_config`, so the playbook manages only the keepalive line.

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

## One Managed Section with blockinfile
<!-- section-summary: blockinfile owns a multi-line block surrounded by stable marker lines. -->

The `ansible.builtin.blockinfile` module manages a block of text inside marker lines. It fits a file where Ansible owns several related lines, while the rest of the file stays under another owner. The markers are important because they show humans and Ansible where the managed section starts and ends.

For the orders service, the team wants higher file descriptor limits for the `orders` user. The OS package baseline and security baseline own most of `/etc/security/limits.conf`, so the playbook adds one marked section.

```yaml
- name: Manage orders service limits
  ansible.builtin.blockinfile:
    path: /etc/security/limits.conf
    marker: '# {mark} ANSIBLE MANAGED ORDERS SERVICE LIMITS'
    block: |
      orders soft nofile 65535
      orders hard nofile 65535
    backup: true
  notify: Restart orders API
```

The marker text should be stable and descriptive. Later runs use it to find the existing block and update it in place. Future readers can also see that the block belongs to automation, which lowers the chance of someone editing the managed section during a production incident.

Blocks work well for small, clearly owned sections. When the managed block grows into most of the file, the team should reconsider full-file ownership with a template. A giant block inside a shared file can hide the real desired state across tasks and make reviews slow and confusing.

## Regex Migrations with replace
<!-- section-summary: replace changes every regex match, so the pattern needs careful scope and review. -->

The `ansible.builtin.replace` module replaces every match of a regular expression in a file. It fits migrations where a known old value may appear in more than one line, such as a deprecated path, hostname, socket location, or feature flag. The module uses Python regular expressions, so it can be precise when the pattern is written carefully.

In the orders fleet, a vendor monitoring agent still points at the old metrics gateway on a few hosts. The agent owns the rest of the config file, and the platform team only wants to move the endpoint.

```yaml
- name: Move orders metrics endpoint to the v2 gateway
  ansible.builtin.replace:
    path: /etc/vendor-agent/agent.conf
    regexp: 'http://metrics-v1\.internal:9090'
    replace: 'http://metrics-v2.internal:9090'
    backup: true
  notify: Restart vendor agent
```

This pattern matches the old endpoint only. The dots are escaped because a dot in a regex means any character. The replacement is the new endpoint, and the task becomes `ok` after the old value disappears.

Broad regex patterns create production surprises. A pattern like `metrics.*9090` could touch comments, examples, or unrelated URLs. A precise pattern includes the exact old value, and a staging diff shows every line that will change before production.

Regex editing is a poor fit for structured files such as YAML, JSON, TOML, and many application config formats when the team owns the whole file. Those files usually belong in a template or a purpose-built module because whitespace, quoting, nesting, and repeated keys can make line-based edits misleading. Use `replace` when the ownership boundary is truly a known text pattern inside someone else's file.

## Validation, Check Mode, and Diff Mode
<!-- section-summary: Partial edits become safer when operators preview the exact line or block before writing it. -->

Partial edits deserve the same review path as full-file templates. Check mode predicts whether the task would change the host, and diff mode shows the line, block, or regex replacement when the module supports diff output. This is especially useful for shared files because each host may have a slightly different starting point.

```bash
ansible-playbook -i inventories/staging orders-shared-files.yml --limit orders-web-stg-01 --check --diff
ansible-playbook -i inventories/staging orders-shared-files.yml --limit orders-web-stg-01
```

For file formats with a parser, add `validate`. SSH config, sudoers, many application configs, and several service tools can validate a candidate file. The validation command should accept the temporary `%s` file directly, or a wrapper script should perform the more complex check.

```yaml
- name: Add sudo rule for orders deployment user
  ansible.builtin.lineinfile:
    path: /etc/sudoers.d/orders-deploy
    line: 'orders-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart orders-api'
    create: true
    owner: root
    group: root
    mode: "0440"
    validate: /usr/sbin/visudo -cf %s
    backup: true
```

Diff mode and secret handling need a careful boundary. A diff for `sshd_config` is usually fine. A diff for a file containing tokens or private values can leak those values into CI logs. For secret-bearing files, teams normally use `no_log: true`, Ansible Vault, and a staging verification command that avoids printing the secret.

## Failure Reading and Idempotency
<!-- section-summary: Reliable partial edits report changed once, then ok, and failures usually point to patterns, validation, or file ownership. -->

**Idempotency** means a task can run repeatedly and keep the same final state without changing the host every time. Partial edit tasks should usually report `changed` on the first real run and `ok` on the second run. When they report `changed` every run, the pattern and replacement probably disagree with each other.

For `lineinfile`, the `regexp` should match the current wrong state and the final right state. The keepalive regex matches `ClientAliveInterval 300` after replacement, so later runs find the line and leave it alone. For `replace`, the pattern should match the old text and disappear after the replacement. For `blockinfile`, the marker should stay stable so Ansible can find the block again.

Here are useful verification commands after a staging run:

```bash
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "sshd -T | grep clientaliveinterval"
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "grep -n 'ANSIBLE MANAGED ORDERS SERVICE LIMITS' /etc/security/limits.conf"
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "grep -n 'metrics-v2.internal' /etc/vendor-agent/agent.conf"
```

Failure messages often map to one of three causes. A validation failure means the candidate file would break the service parser. A missing file failure means the task needs `create: true` or the team chose the wrong ownership boundary. A changed-every-run result means the regex, marker, or replacement needs a tighter shape.

## Rollback and Safety
<!-- section-summary: Backups, small limits, service validation, and Git rollback keep shared-file edits recoverable. -->

Partial edits can affect files that operators rely on during emergencies, so rollback needs to be simple. `backup: true` gives a timestamped copy before the edit. Git gives the reviewed source of truth. A small production limit lets the team watch one host before touching the whole fleet.

```bash
ansible-playbook -i inventories/production orders-shared-files.yml --limit orders-web-prod-01 --diff
ansible-playbook -i inventories/production orders-shared-files.yml --limit orders_web --forks 2
```

If SSH validation fails, the live file stays in place and the handler remains unqueued. If a bad edit passes validation and causes an operational issue, restore the backup on the affected host, reload the service, and then fix or revert the playbook source so the next run matches the intended state.

```bash
sudo cp /etc/ssh/sshd_config.12345.2026-06-13@12:30:42~ /etc/ssh/sshd_config
sudo sshd -t -f /etc/ssh/sshd_config
sudo systemctl reload sshd
```

The manual restore is the emergency step. The durable rollback is a commit that returns the automation to the desired content, followed by a normal Ansible run. That keeps the shared file from drifting again during the next deployment.

## Putting It All Together
<!-- section-summary: lineinfile, blockinfile, and replace keep automation precise when files have multiple owners. -->

The orders web fleet now has a clear partial-edit approach. `lineinfile` owns one SSH keepalive line. `blockinfile` owns one marked limits section for the service user. `replace` moves one old metrics endpoint across the vendor agent file. Each task has a tight ownership boundary, and risky files use validation or backups.

The operator workflow mirrors full-file management. Preview with `--check --diff`, run in staging, verify the parser and resulting content, then roll through production in small batches. A task that reports `ok` on the second run gives you confidence that the edit is repeatable.

Those file changes often need service actions after they land. The next article connects changed tasks to handlers, reloads, restarts, health checks, and rollback behavior.

## What's Next

The next article covers handlers and restarts. Once a template, line edit, block edit, or replacement changes a service input, Ansible needs a clean way to run the service action once and only when the input changed.

---

**References**

- [ansible.builtin.lineinfile](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/lineinfile_module.html) - Official module documentation for managing a single line in a text file.
- [ansible.builtin.blockinfile](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/blockinfile_module.html) - Official module documentation for managing marked multi-line blocks.
- [ansible.builtin.replace](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/replace_module.html) - Official module documentation for regex-based replacements.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official playbook guide for previewing and reviewing changes.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official guide for running service actions after changed tasks.
