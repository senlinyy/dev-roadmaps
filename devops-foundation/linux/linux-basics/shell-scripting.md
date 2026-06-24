---
title: "Shell Scripting"
description: "Write Bash scripts with variables, conditionals, loops, and functions to automate repetitive server tasks."
overview: "Write practical Bash scripts for a Linux VM: deploy a small API, validate Nginx, run health checks, and fail loudly when a step goes wrong."
tags: ["bash", "variables", "loops"]
order: 3
id: article-devops-foundation-linux-linux-basics-shell-scripting
---

## Table of Contents

1. [Why Scripts Matter on the API VM](#why-scripts-matter-on-the-api-vm)
2. [What a Shell Script Is](#what-a-shell-script-is)
3. [Shebang, Execute Bit, and `PATH`](#shebang-execute-bit-and-path)
4. [Variables and Quoting](#variables-and-quoting)
5. [Exit Codes and Branching](#exit-codes-and-branching)
6. [A Safer Deploy Script](#a-safer-deploy-script)
7. [Functions, `trap`, and Cleanup](#functions-trap-and-cleanup)
8. [Loops and Safe File Handling](#loops-and-safe-file-handling)
9. [References](#references)

## Why Scripts Matter on the API VM
<!-- section-summary: Shell scripts turn repeated server operations into reviewed, repeatable commands. -->

After you can navigate the filesystem and edit a config file, the next problem is repetition. The `inventory-api` VM has tasks that happen again and again: pull a release artifact, install dependencies, restart the API service, validate Nginx, check the health endpoint, and inspect logs when something fails.

Typing those steps manually works once. The risk grows when the team deploys every day or when a tired engineer has to repair the server during an incident. A shell script captures the known sequence so the operator runs one reviewed command instead of remembering ten small details.

Bash is a good fit for this layer because it orchestrates other programs. It calls `systemctl`, `curl`, `rsync`, `tar`, `journalctl`, `nginx -t`, and package tools. Larger business logic belongs in a language with stronger data structures and tests, but server glue often belongs in Bash because every Linux VM already has it.

## What a Shell Script Is
<!-- section-summary: A shell script is a text file of commands that Bash executes in order. -->

A **shell script** is a plain text file containing commands for a shell to run. Bash reads the file from top to bottom, expands variables, runs commands, checks exit codes, and moves to the next line. Anything you can type into a terminal can usually go into a script.

The smallest script for our VM might check the API health endpoint:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/health
```

Saved as `check-api.sh`, it can run through Bash:

```bash
$ bash check-api.sh
```

That is already useful. The command returns success only when the API responds with a successful HTTP status. A deployment script can use that fact after restarting the service.

As scripts grow, the goal is clarity. A good operations script makes the important paths, service names, and checks obvious. A future engineer should be able to open the file and understand which machine state it changes.

## Shebang, Execute Bit, and `PATH`
<!-- section-summary: The shebang tells Linux which interpreter runs the script, and the execute bit allows direct execution. -->

When a script runs directly as `./deploy.sh`, Linux needs to know which interpreter should read it. The first line handles that:

```bash
#!/usr/bin/env bash
```

The `#!` sequence is the **shebang**. It tells the kernel to start the program that follows and pass the script file to it. `/usr/bin/env bash` asks the environment to find `bash` using `PATH`, which helps when Bash lives in a different location across systems.

The file also needs execute permission:

```bash
$ chmod +x scripts/deploy-inventory-api.sh
$ ./scripts/deploy-inventory-api.sh
```

The `./` prefix matters. Your shell searches the directories listed in `PATH` when you type a bare command name. The current directory usually is not in `PATH` for security reasons, so `./scripts/deploy-inventory-api.sh` gives the shell an explicit relative path.

A team can place stable admin scripts in `/usr/local/sbin` or `/usr/local/bin`, then call them by name. For a small VM, keeping scripts in `/srv/inventory-api/scripts` may be enough as long as the deployment procedure uses the full path.

## Variables and Quoting
<!-- section-summary: Bash variables store strings, and quoting keeps those strings as one argument after expansion. -->

Bash variables are strings. They hold paths, service names, URLs, release versions, and command output. Assignment has no spaces around the equals sign:

```bash
app_name="inventory-api"
app_dir="/srv/inventory-api"
health_url="http://127.0.0.1:3000/health"
```

Values are read with `$name` or `${name}`. The braced form is clearer when text touches the variable:

```bash
log_file="/var/log/${app_name}/deploy.log"
```

Quoting is the daily safety rule. Use `"$app_dir"` instead of `$app_dir` when passing a variable to a command. Without quotes, Bash splits the expanded value on whitespace and also expands wildcard characters. With quotes, the value stays one argument.

```bash
release_dir="/srv/inventory-api/releases/2026-06-24 09-30"

mkdir -p "$release_dir"
tar -xzf "$HOME/releases/inventory-api.tar.gz" -C "$release_dir"
```

Command substitution stores command output in a variable:

```bash
release_id=$(date +%Y%m%d-%H%M%S)
current_commit=$(git -C "$app_dir" rev-parse --short HEAD)
```

The same quoting rule applies after substitution. Store the value, quote it when used, and avoid relying on luck when a path or branch name contains a surprising character.

## Exit Codes and Branching
<!-- section-summary: Scripts make decisions from exit codes, where `0` means success and nonzero values represent failure. -->

Every Linux command returns an **exit code**. `0` means success. Any nonzero value means the command failed in some way. Bash stores the last exit code in `$?`, and `if` statements use command success directly.

For the API VM, this makes health checks simple:

```bash
if curl --fail --silent --show-error "$health_url"; then
    echo "API health check passed"
else
    echo "API health check failed"
    exit 1
fi
```

The `[[ ... ]]` syntax handles tests inside Bash:

```bash
config_file="/etc/nginx/sites-enabled/inventory-api.conf"

if [[ -f "$config_file" && -r "$config_file" ]]; then
    echo "Nginx site config is readable"
else
    echo "Missing or unreadable config: $config_file"
    exit 1
fi
```

Common test operators include:

| Operator | Meaning |
|---|---|
| `-f path` | Regular file exists |
| `-d path` | Directory exists |
| `-r path` | Current user can read it |
| `-w path` | Current user can write it |
| `-x path` | Current user can execute it |
| `-z string` | String is empty |
| `-n string` | String has content |
| `a = b` | Strings match |
| `n -gt m` | Integer `n` is greater than `m` |

This is the core of shell scripting. Run a command, check whether it succeeded, then choose the next step.

## A Safer Deploy Script
<!-- section-summary: A production script should fail early, name important paths, validate services, and leave a clear rollback clue. -->

The first production-grade habit is adding strict mode near the top:

```bash
set -euo pipefail
```

`set -e` exits when a command fails. `set -u` exits when the script reads an unset variable. `pipefail` makes a pipeline fail when any command inside it fails, rather than only the final command. These settings help scripts fail near the real problem instead of continuing with half-finished state.

A small deploy script can look like this:

```bash
#!/usr/bin/env bash
set -euo pipefail

app_name="inventory-api"
app_dir="/srv/inventory-api"
release_archive="${1:?usage: deploy-inventory-api.sh /path/to/release.tar.gz}"
release_id=$(date +%Y%m%d-%H%M%S)
release_dir="${app_dir}/releases/${release_id}"
current_link="${app_dir}/current"
health_url="http://127.0.0.1:3000/health"

mkdir -p "$release_dir"
tar -xzf "$release_archive" -C "$release_dir"

ln -sfn "$release_dir" "$current_link"

sudo systemctl restart "$app_name"
sleep 2

curl --fail --silent --show-error "$health_url" >/dev/null
sudo nginx -t
sudo systemctl reload nginx

echo "Deployed ${app_name} release ${release_id}"
```

The script names the service, app directory, release directory, symlink, and health URL at the top. That makes review easier. The release archive is required through `${1:?message}`, which prints the message and exits if the caller forgets the argument.

The symlink pattern gives the VM a simple release structure. Each release gets its own directory under `/srv/inventory-api/releases`, and `/srv/inventory-api/current` points at the active one. Rollback can point the symlink back to the previous release, restart the service, and rerun the health check.

This script still assumes the unit file uses `/srv/inventory-api/current` as its working directory. Scripts and service files need to agree on paths. That is why the next system administration articles connect Bash with systemd and process inspection.

## Functions, `trap`, and Cleanup
<!-- section-summary: Functions group repeated work, and traps run cleanup or diagnostics when a script exits. -->

Functions keep repeated operations named and readable. A deploy script might have separate functions for validation, health checks, and rollback hints:

```bash
log() {
    printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

check_health() {
    curl --fail --silent --show-error "$health_url" >/dev/null
}

validate_nginx() {
    sudo nginx -t
}
```

The `local` keyword keeps a function variable from leaking into the rest of the script:

```bash
wait_for_health() {
    local attempt

    for attempt in {1..10}; do
        if check_health; then
            return 0
        fi
        sleep 1
    done

    return 1
}
```

`trap` registers a command to run when the script receives a signal or exits. This is useful for cleanup and diagnostics:

```bash
on_error() {
    local exit_code=$?
    echo "Deploy failed with exit code ${exit_code}"
    echo "Recent service logs:"
    journalctl -u inventory-api --no-pager -n 30
    exit "$exit_code"
}

trap on_error ERR
```

With this trap, a failed health check prints recent service logs before the script exits. That is practical industrial polish: the script fails with the first clue already attached.

## Loops and Safe File Handling
<!-- section-summary: Loops repeat checks across files or hosts, and null-delimited file lists handle awkward filenames safely. -->

Loops let a script repeat one operation across a known list. For the API VM, a health script may check the local API and the public Nginx endpoint:

```bash
for url in "http://127.0.0.1:3000/health" "https://api.example.com/health"; do
    if curl --fail --silent --show-error "$url" >/dev/null; then
        echo "ok: $url"
    else
        echo "failed: $url"
        exit 1
    fi
done
```

When looping over files from `find`, filenames may contain spaces, quotes, or newlines. The safer pattern uses null-delimited output from `find -print0` and reads it with `read -d ''`:

```bash
find /srv/inventory-api/releases -maxdepth 1 -type d -mtime +14 -print0 |
while IFS= read -r -d '' old_release; do
    echo "Old release candidate: $old_release"
done
```

The script above only prints candidates. A real cleanup script should also keep the active `current` target, keep at least one previous release, and log what it removes. Deleting files in automation deserves extra care because a small path bug can remove the wrong tree.

Shell scripting grows naturally from here. Start with one repeated command, add variables for the important paths, quote every expansion, check exit codes, add functions for repeated behavior, and print useful diagnostics when the script stops.

## References

- [GNU Bash manual](https://www.gnu.org/software/bash/manual/bash.html) - Official Bash reference for shell syntax, expansion, variables, and execution.
- [Bash conditional expressions](https://www.gnu.org/software/bash/manual/html_node/Bash-Conditional-Expressions.html) - Documents `[[ ... ]]` test operators.
- [Bash shell parameter expansion](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html) - Documents `${var}`, default values, and required-argument expansion.
- [Bash `set` builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html) - Documents `-e`, `-u`, and related shell options.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents service restart and reload behavior used by scripts.
- [Nginx command-line parameters](https://nginx.org/en/docs/switches.html) - Documents `nginx -t` for configuration validation.
