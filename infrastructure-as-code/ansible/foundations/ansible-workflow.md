---
title: "Ansible Workflow"
description: "Run Ansible in a safe order: read inventory, test access, preview supported changes, apply, read the recap, and rerun."
overview: "A first Ansible workflow should prove each layer before it changes machines."
tags: ["ansible", "workflow", "check-mode", "diff-mode"]
order: 2
id: article-infrastructure-as-code-ansible-workflow
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Start With the Map](#start-with-the-map)
3. [Test the Connection](#test-the-connection)
4. [Preview What Can Be Previewed](#preview-what-can-be-previewed)
5. [Run One Host First](#run-one-host-first)
6. [Read the Recap](#read-the-recap)
7. [Run It Again](#run-it-again)
8. [Common Surprises](#common-surprises)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The first Ansible run is where many teams learn that automation is still real change. A playbook can install packages, rewrite files, restart services, and touch every host selected by its pattern. The file may be reviewable, but the run still needs a careful order.

For the orders service, imagine a small Nginx config change. The team wants to send traffic from Nginx to `orders-api` on port `8081` instead of `8080`. The change sounds narrow, but several different things can go wrong:

- The inventory might include an old host that is no longer behind the load balancer.
- SSH might work from a laptop but fail from CI.
- Check mode might show a safe template diff, but another task may need real state created earlier in the play.
- The first production host might reload Nginx successfully while the second host has a local config drift.

A safe workflow does not promise that nothing will fail. It makes each layer visible before the blast radius grows. The order is simple: read the map, test access, preview supported changes, run one host, read the recap, then run again to see whether the host settled.

## Start With the Map

Inventory decides which machines Ansible can touch. Before thinking about package tasks or templates, make sure Ansible loaded the host map you intended.

The orders production inventory might contain this group:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.40.10.21
        orders-web-02:
          ansible_host: 10.40.10.22
      vars:
        ansible_user: deploy
```

The first check should not connect to the hosts. It should only ask Ansible what it parsed.

```bash
ansible-inventory -i inventory/prod.yml --graph
```

A small production inventory should produce a small graph:

```text
@all:
  |--@ungrouped:
  |--@orders_web:
  |  |--orders-web-01
  |  |--orders-web-02
```

This command is quiet but important. If `orders-api-01` appears under `orders_web`, the playbook is not the problem yet. The target set is wrong. Fix that before running any task.

For a single host, inspect the merged host view:

```bash
ansible-inventory -i inventory/prod.yml --host orders-web-01
```

That output shows values such as `ansible_host` and `ansible_user` after Ansible has loaded inventory and variable files. If Ansible is about to connect to the wrong address or use the wrong login user, this is the first place you want to see it.

## Test the Connection

After the map looks right, prove that Ansible can run a small module on the selected hosts. The common beginner command uses Ansible's `ping` module.

```bash
ansible orders_web -i inventory/prod.yml -m ansible.builtin.ping
```

This is not an ICMP network ping. It does not mean "send an echo packet to the host." It means Ansible will use its normal connection path, run a small module, and wait for a response.

A successful result looks like this:

```text
orders-web-01 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
orders-web-02 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

This proves a specific thing: Ansible matched the hosts, connected to them, ran a module, and received results. It does not prove that package installation will work. It does not prove sudo is configured. It does not prove the playbook is correct. It only proves the access layer.

That narrow meaning is useful. If this command returns `UNREACHABLE`, stay with connection problems: inventory address, DNS, SSH user, key, host key checking, VPN, bastion, or firewall. A template edit cannot fix a host that Ansible cannot reach.

## Preview What Can Be Previewed

Many Ansible modules support check mode. Check mode asks what would change without applying the change. Diff mode asks supported modules to show file differences.

For the orders Nginx change, the team can narrow the preview to one host:

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --check \
  --diff \
  --limit orders-web-01
```

The limit keeps the preview focused. The diff shows what supported file tasks expect to change.

```diff
-proxy_pass http://127.0.0.1:8080;
+proxy_pass http://127.0.0.1:8081;
```

This diff is useful because it connects the playbook to a concrete file change. It says the template task expects to change the upstream port and nothing else in that line.

Check mode has limits. Some modules can predict changes well. Some cannot. Some tasks depend on earlier tasks that check mode did not actually perform. A service reload may be skipped because the template was not really written. A command task may not know whether it would change anything unless the author gave it extra conditions.

Diff mode has another practical surprise: it can expose secrets. If a template contains credentials, `--diff` can print them into terminal logs or CI output. Use diff mode where it helps review a real change, and avoid printing secret-bearing files.

## Run One Host First

After the map, connection, and preview look right, run the playbook for real on one host.

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders-web-01
```

The command should make the scope visible. Anyone reading it can see the inventory, playbook, and first host.

A first-host run is useful because it separates "does the change work anywhere?" from "should it reach every machine?" If the Nginx config is invalid, only `orders-web-01` should find out first. If the service reload succeeds and the host stays healthy, the team has stronger evidence before widening the run.

Ansible also has play-level strategies and batching features, but a simple `--limit` is enough for a first workflow. More advanced rollout controls make sense only after the team understands what the command will match.

## Read the Recap

The recap is the run's first summary. Read it by host instead of only checking whether the command exited successfully.

```text
PLAY RECAP
orders-web-01 : ok=12 changed=2 unreachable=0 failed=0 skipped=1
```

This says Ansible reached the host, no task failed, and two tasks changed state. For an Nginx template update, that might be exactly right: one template task changed the file, and one handler reloaded Nginx.

The numbers should match the story of the change.

| Recap field | What to ask |
| --- | --- |
| `unreachable` | Did Ansible connect to every selected host? |
| `failed` | Did any task reach the host and fail? |
| `changed` | Does the number of changes make sense for this run? |
| `skipped` | Were tasks skipped because of check mode, conditions, or host facts? |

A high `changed` count is not automatically bad. A newly built host may need many changes. A host that was already managed yesterday should usually change less. The recap becomes more useful when you compare it to what you expected before the run.

## Run It Again

After a successful first run, run the same command again against the same host.

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders-web-01
```

For stable configuration, the second run should usually show fewer changes. Many tasks should report `ok`. This is a simple idempotency check.

If the same template changes every run, look for generated timestamps, unstable ordering, local facts that change, or variables that differ between runs. If a service restarts every run, check whether a handler is being notified by a task that always reports changed. If a shell command always reports changed, the task may need `changed_when`, a better module, or a condition that checks current state first.

The second run is easy to skip because the first run already succeeded. It is also one of the fastest ways to find tasks that describe actions instead of desired state.

## Common Surprises

A safe workflow works because each command answers a narrow question.

| Step | What it proves | What it does not prove |
| --- | --- | --- |
| `ansible-inventory --graph` | Ansible parsed the expected host groups. | The hosts are reachable. |
| `ansible-inventory --host` | One host's merged values look right. | The playbook will use every value safely. |
| `ansible ... -m ping` | The connection path can run a small module. | Sudo and service tasks will work. |
| `--check --diff` | Supported modules can preview some changes. | The real run cannot fail. |
| First-host run | One real host can apply the change. | The rest of the group has the same state. |
| Second run | The first host may have settled. | Every task is correct in every environment. |

The main surprise is that no single command proves everything. That is why the workflow is layered. Each step removes one kind of uncertainty before the next step can do more damage.

## Putting It All Together

The orders team wanted to change an Nginx upstream port without learning about target mistakes during a full production run.

The safe path was:

1. Read the inventory graph and confirm only `orders-web-01` and `orders-web-02` are in `orders_web`.
2. Inspect one host's merged values and confirm the address and login user.
3. Run the Ansible ping module to prove remote execution.
4. Use check mode and diff mode to inspect the supported file change.
5. Apply the playbook to `orders-web-01` only.
6. Read the recap and compare `changed` with the expected template and reload.
7. Run the same command again and check that the host settled.

This workflow is not slow ceremony. It is how you learn which layer is wrong while the target set is still small.

## What's Next

The next group goes deeper into inventory and connections. Ansible can only be safe when the host map, connection address, login user, and privilege boundary are clear.

---

**References**

- [ansible-inventory command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
- [ansible command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible.html)
- [ansible-playbook command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html)
