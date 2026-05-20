---
title: "Check and Diff Mode"
description: "Use Ansible check mode and diff mode as review evidence while knowing which predictions can be incomplete."
overview: "Check mode and diff mode help teams inspect planned Ansible changes before they touch hosts, while still treating preview output as evidence rather than a guarantee."
tags: ["ansible", "check-mode", "diff"]
order: 3
id: article-infrastructure-as-code-ansible-check-diff-mode
---

## Table of Contents

1. [Why Preview Matters](#why-preview-matters)
2. [Check Mode](#check-mode)
3. [Diff Mode](#diff-mode)
4. [Reading Preview Output](#reading-preview-output)
5. [Where Preview Is Weak](#where-preview-is-weak)
6. [Safe Review Evidence](#safe-review-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Preview Matters

Ansible can change a host quickly. That is useful when the playbook is correct and the target set is right. It is risky when a variable points at the wrong port, a template renders a secret into output, or the run includes more hosts than expected.

The `orders` service is about to move `orders-api` from local port `8080` to `8081`. Nginx must proxy to the new port. The systemd unit or environment file must start the process on the new port. The health check must follow the same value. Before the team applies the change to production, they want to answer a few plain questions:

- Which hosts would this playbook touch?
- Which tasks believe they would change something?
- Which text files would have different content?
- Would any secret-bearing file appear in the output?
- Which checks are skipped because the service is not actually changed yet?

Check mode and diff mode help answer those questions. Check mode asks supported modules what they would do without making changes. Diff mode asks supported modules to show before-and-after content. They can be used separately, but they are often most useful together.

The preview is evidence, not a promise. It tells you what Ansible can predict from the current host state, the current variables, and the modules involved. The real run can still fail because a service restart behaves differently, a command task has side effects, a dependency is unavailable, or a later task depends on state that check mode did not create.

## Check Mode

Check mode is Ansible's dry-run mode. In check mode, Ansible still reads inventory, loads variables, evaluates tasks, connects to managed hosts, and asks modules that support check mode what would change. Those modules report predicted change without applying it.

For the `orders` port change, the team first wants a preview against one host:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --check \
  --limit orders-web-01
```

A useful result might look like this:

```text
TASK [Render orders-api environment] changed: [orders-web-01]
TASK [Render nginx site] changed: [orders-web-01]
TASK [Restart orders-api] skipping: [orders-web-01]
TASK [Check local orders-api health] skipping: [orders-web-01]

PLAY RECAP
orders-web-01 : ok=9 changed=2 unreachable=0 failed=0 skipped=2
```

The recap says two tasks predict changes. That is plausible for a port change: the service environment and Nginx site should change. The restart and health check may skip because the playbook is in check mode and the new service state does not exist yet.

Check mode is strongest when the task uses a module that understands desired state. Template, file, package, service, user, and many other modules can often compare current state with desired state. A raw command is different. Ansible cannot know what an arbitrary script will change unless the task gives it more information.

This command task is hard to preview:

```yaml
- name: Run orders migration
  ansible.builtin.command: /opt/orders/bin/migrate
```

Ansible can run or skip the command depending on task settings, but it cannot infer what database rows the script would change. If a command has a clear filesystem guard, use `creates` or `removes`. If the command should report changed only under a known condition, use `changed_when`. Those settings do not make every command safe, but they give Ansible a clearer contract.

## Diff Mode

Check mode tells you that something would change. Diff mode helps explain the text change. For the `orders` service, a plain `changed` line is less useful than seeing that Nginx moves from one local port to another.

Run diff mode with check mode when you want a preview artifact:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --check \
  --diff \
  --limit orders-web-01
```

For a public Nginx template, the output might include:

```diff
- proxy_pass http://127.0.0.1:8080;
+ proxy_pass http://127.0.0.1:8081;
```

That small diff carries a lot of meaning. It proves the variable reached the Nginx template. It shows the old and new values. It gives a reviewer something specific to approve or reject.

Diff mode should be selective. A diff is useful when the file is text, stable, and safe to read. It is weak or unsafe when the file is binary, generated with timestamps, very large, or full of secrets. The `orders.env` file contains `DATABASE_PASSWORD` and `SESSION_SECRET`, so it should suppress diff output even when the playbook is run with `--diff`.

```yaml
- name: Render orders-api environment
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders-api/orders.env
    owner: root
    group: orders-api
    mode: "0640"
  no_log: true
  diff: false
```

The absence of a diff for that file is part of the safety design. The review should show that the task is hidden, not the secret values inside it.

## Reading Preview Output

Good preview output starts with the target set. Check mode is not useful if it is aimed at the wrong hosts. Before reading task results, list the hosts that the playbook would use:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --list-hosts \
  --limit orders-web-01
```

The output should match the intended canary:

```text
playbook: playbooks/orders.yml

  play #1 (orders_web): Roll out orders-api
    pattern: ['orders_web']
    hosts (1):
      orders-web-01
```

Now the preview has a boundary. The team knows the inventory is production, the playbook targets `orders_web`, and the limit narrowed the run to one host.

When you read check output, focus on the pattern of change. For the port move, it makes sense for Nginx and the service environment to change together. It would be suspicious if Nginx changed but the service environment did not, because that could leave Nginx pointing at a port where nothing listens. It would also be suspicious if a secret task printed a diff, because the previous article's boundary would be broken.

The recap is useful, but it is only a summary:

```text
orders-web-01 : ok=9 changed=2 unreachable=0 failed=0 skipped=2
```

`changed=2` tells you two tasks predicted changes. It does not tell you whether those changes are the right two. The task names and diffs provide the real review detail.

## Where Preview Is Weak

Check mode does not create a full temporary copy of the host. Each task runs against the current host state and predicts what it can. That matters when later tasks depend on earlier changes.

For example, one task might create `/etc/orders-api`, and a later task might inspect a file inside that directory. In the real run, the directory exists by the time the later task runs. In check mode, the directory may not be created, so the later task can skip, fail, or produce incomplete output. The preview is still useful, but the reader needs to know why it is incomplete.

Registered variables are another common surprise. A task can register a result, and a later task can use that result in a condition. In check mode, a skipped task may not produce the same registered data as a real run. A condition that depends on that data can behave differently.

Handlers also need careful reading. A template can report `changed` and notify `Restart orders-api`. In check mode, that tells you a restart would be requested. It does not prove that the restarted service will be healthy on port `8081`. That proof belongs in the real rollout with a health check after handlers run.

Modules differ too. Some modules support check mode and diff mode well. Some support one but not the other. Some command-style tasks cannot predict much. A clean preview does not mean every later operation is guaranteed.

## Safe Review Evidence

The safest preview artifact combines several small pieces:

| Evidence | What It Proves | What It Does Not Prove |
| --- | --- | --- |
| `--list-hosts` | The selected host set | That tasks will succeed |
| `--check` recap | Predicted task changes | Final service health |
| Public diffs | Exact safe text changes | Secret values or binary changes |
| Hidden secret tasks | Secret output boundary exists | The secret value is correct |
| Later health task | The playbook has a runtime check | The check already passed in dry run |

For the `orders` change, the review artifact should show one canary host, the Nginx port diff, the expected service configuration task marked changed but censored, and no secret text. It should also show that a health check exists, even if the check is skipped in dry run.

This is the right mental model:

```text
Preview output can stop obvious mistakes.
It cannot replace a controlled apply run.
```

The preview can catch a wrong port, wrong host, missing variable, public diff mismatch, or accidental secret output. The apply run still needs rollout controls because the service only truly changes during the real run.

## Putting It All Together

The `orders` team wanted proof before changing production. They listed the hosts first so the preview had a clear boundary. They ran `--check` to see which tasks predicted change. They added `--diff` so public text changes were visible. They hid the secret environment file with `no_log: true` and `diff: false`.

That gave them useful evidence without pretending the dry run was the final state. The preview showed what Ansible could predict. The next safety layer is execution scope: changing one host or one batch, running handlers, checking health, and stopping before a bad change spreads.

## What's Next

The next article covers `--limit`, `serial`, and health checks. These controls take the change from review evidence into a real rollout while keeping the blast radius small.

---

**References**

- [Ansible documentation: Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Ansible documentation: ansible-playbook command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Ansible documentation: Patterns: targeting hosts and groups](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_patterns.html)
- [Ansible documentation: Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html)
