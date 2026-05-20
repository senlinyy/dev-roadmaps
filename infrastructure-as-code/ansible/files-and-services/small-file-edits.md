---
title: "Small File Edits"
description: "Use lineinfile, blockinfile, and replace when Ansible should manage only part of a file."
overview: "Some files are shared. For those files, Ansible should manage the smallest clear region."
tags: ["ansible", "lineinfile", "blockinfile", "replace"]
order: 2
id: article-infrastructure-as-code-ansible-small-file-edits
---

## Table of Contents

1. [Shared Files](#shared-files)
2. [One Line](#one-line)
3. [One Block](#one-block)
4. [Pattern Replacement](#pattern-replacement)
5. [Validation](#validation)
6. [When a Template Is Better](#when-a-template-is-better)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Shared Files

The previous article managed complete files. That is the cleanest pattern when the team owns the whole file. A service-specific Nginx site, a systemd unit, and an environment file are good examples because the `orders` team can say, "This entire file belongs to the role."

Some files do not have that clear owner. A package may create them. Another role may add its own section. The operating system may update comments during package upgrades. In those cases, replacing the whole file can erase someone else's state.

For the `orders` service, small edits might be enough:

- Add one timeout line to a shared Nginx include.
- Manage one upstream block in a file that contains several upstreams.
- Replace an old socket path during a migration.

Ansible has modules for these narrow edits. They are useful, but they are also easy to misuse. A small edit needs a clear boundary. The playbook should make it obvious which line, block, or pattern Ansible owns.

## One Line

Use `ansible.builtin.lineinfile` when one logical line should exist in a file. The module can add the line if it is missing or replace an existing matching line.

Suppose the shared Nginx include has a timeout for proxied service calls. The `orders` service needs the timeout to be `30s`.

```yaml
- name: Set orders proxy timeout
  ansible.builtin.lineinfile:
    path: /etc/nginx/conf.d/orders-common.conf
    regexp: "^\\s*proxy_read_timeout\\s+"
    line: "proxy_read_timeout 30s;"
```

The `regexp` finds an existing `proxy_read_timeout` line, even if the value is different. The `line` is the desired final line. If the old file says `proxy_read_timeout 10s;`, Ansible replaces that line. If no matching line exists, Ansible adds the desired line.

The regular expression is the safety boundary. If it is too broad, Ansible may replace the wrong setting. If it is too narrow, Ansible may fail to recognize a line it already wrote and append a duplicate on the next run.

A good `lineinfile` expression usually matches both the old form and the desired form. That keeps the task idempotent, which means repeated runs keep producing `ok` after the file is correct.

Line placement matters too. If a line belongs inside a specific Nginx `location` block, a plain file-wide search may not be enough. `lineinfile` can insert before or after another matching line, but if the surrounding structure is complex, a full template or a block may be easier to reason about.

## One Block

Use `ansible.builtin.blockinfile` when Ansible should own several neighboring lines. The module surrounds the block with marker lines. On later runs, Ansible finds those markers and replaces only the managed block.

For a shared upstream file, the `orders` role can own just the `orders_api` block:

```yaml
- name: Manage orders upstream block
  ansible.builtin.blockinfile:
    path: /etc/nginx/conf.d/upstreams.conf
    marker: "# {mark} ANSIBLE MANAGED ORDERS UPSTREAM"
    block: |
      upstream orders_api {
        server 127.0.0.1:8080;
        keepalive 16;
      }
```

The resulting file will contain marker lines around the block. Humans can see that the block is managed, and Ansible can find the same block later.

The marker needs to be specific. A generic marker such as `# {mark} ANSIBLE MANAGED BLOCK` is confusing when the file has several managed blocks. A marker that names `ORDERS UPSTREAM` tells the next reader which role owns that region.

Markers are part of the contract. If someone removes them by hand, Ansible may insert a new block instead of updating the old one. That can create duplicate upstream definitions. Small edits work best when the managed region is visible and respected.

## Pattern Replacement

Use `ansible.builtin.replace` when every match for a pattern should change. This is common during small migrations where a value appears more than once.

Suppose the `orders` service is moving from an old socket path to a new one:

```yaml
- name: Replace old orders socket path
  ansible.builtin.replace:
    path: /etc/orders/runtime.conf
    regexp: "/run/orders-old.sock"
    replace: "/run/orders-api.sock"
```

This task replaces each matching old socket path in the file. That is different from `lineinfile`, which is usually about one final line.

The practical surprise is idempotence. The Ansible documentation puts the burden on the user to keep replacement idempotent. If the pattern can match the replacement text, the task may report changed again or alter the file repeatedly. For example, replacing `orders` with `orders-api` would also match the new value if the pattern is not careful.

Use `replace` when the text pattern is simple and the scope is clear. Avoid it when the file format is structured and the same text can appear in comments, examples, or unrelated sections. A broad replacement can be technically successful and still change the wrong meaning.

## Validation

Small edits can break a file just as easily as full templates can. A missing semicolon in Nginx config or a malformed system file can affect the service even though Ansible changed only one line.

The small-edit modules support validation. The command checks a temporary candidate file before Ansible writes it into place.

```yaml
- name: Set orders proxy timeout
  ansible.builtin.lineinfile:
    path: /etc/nginx/conf.d/orders-common.conf
    regexp: "^\\s*proxy_read_timeout\\s+"
    line: "proxy_read_timeout 30s;"
    validate: "nginx -t -c %s"
```

The `%s` placeholder is the temporary file. If the validation command fails, Ansible does not replace the real file.

Validation is especially helpful with shared files because the task may be changing only one part of a larger configuration. The validation command checks the candidate as a whole file, including the edited line in its real context. That catches mistakes the narrow edit cannot see by itself.

## When a Template Is Better

Small edits are not automatically safer than templates. They are safer only when Ansible truly owns a small, well-defined part of a shared file.

If the `orders` team owns the entire Nginx site file, a template is clearer than ten `lineinfile` tasks. The template shows the final shape in one place. Reviewers can read the file as the service will read it.

If the file is a package-managed file with one local setting, a small edit is usually better. The task says exactly which setting Ansible owns and leaves the rest of the file alone.

This is the decision:

| Situation | Better fit | Why |
|-----------|------------|-----|
| The team owns the whole file | `template` or `copy` | The final file is easier to read and review. |
| One setting in a shared file | `lineinfile` | The ownership boundary is one line. |
| One owned section in a shared file | `blockinfile` | Markers show the managed region. |
| A simple repeated text migration | `replace` | The pattern changes all intended matches. |

The wrong pattern is to rebuild a whole file out of many small edits. That spreads the final state across many tasks, and the reader has to mentally execute the playbook to know what the file will look like.

## Putting It All Together

Small file edits are about ownership. The `orders` role should manage the smallest region that matches the team's responsibility. One timeout line can be a `lineinfile` task. One upstream stanza can be a `blockinfile` task with a specific marker. A simple old socket path can be a `replace` task. Each one should be narrow enough that a reviewer knows what Ansible owns.

The surprises are practical. The regular expression must match the right thing after the file is already correct. Block markers must be unique and stable. Replacement patterns must not match their own replacement. Validation should protect important config files even when the edit is small.

Small edits keep Ansible from taking over files it does not own. They do not remove the need to think about the final file.

## What's Next

Changing a file is often only half the job. The next article covers handlers, which connect changed file tasks to the service reloads or restarts that make those changes take effect.

---

**References**

- [ansible.builtin.lineinfile module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/lineinfile_module.html)
- [ansible.builtin.blockinfile module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/blockinfile_module.html)
- [ansible.builtin.replace module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/replace_module.html)
