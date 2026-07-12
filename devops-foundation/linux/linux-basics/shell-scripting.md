---
title: "Shell Scripting"
description: "Write Bash scripts with variables, conditionals, loops, and functions to automate repetitive server tasks."
overview: "Write practical Bash scripts for Linux operations: deploy a release, validate Nginx, run health checks, and fail loudly when a step goes wrong."
tags: ["bash", "variables", "loops"]
order: 3
id: article-devops-foundation-linux-linux-basics-shell-scripting
---

## Table of Contents

1. [Why Scripts Matter](#why-scripts-matter)
2. [What a Shell Script Is](#what-a-shell-script-is)
3. [Shebang, Execute Bit, and `PATH`](#shebang-execute-bit-and-path)
4. [Variables and Quoting](#variables-and-quoting)
5. [Exit Codes and Branching](#exit-codes-and-branching)
6. [A Safer Deploy Script](#a-safer-deploy-script)
7. [Functions, `trap`, and Cleanup](#functions-trap-and-cleanup)
8. [Loops and Safe File Handling](#loops-and-safe-file-handling)
9. [References](#references)

## Why Scripts Matter
<!-- section-summary: Shell scripts turn repeated server operations into reviewed, repeatable commands. -->

After you can navigate the filesystem and edit a config file, the next problem is repetition. A deploy over SSH often turns into the same chain of commands: pull a release artifact, install dependencies, restart a service, validate Nginx, check a health endpoint, and inspect logs when something fails.

Typing those steps manually works once. The risk grows when the team deploys every day or when someone repairs a server during an incident. A shell script captures the known sequence so the operator runs one reviewed command instead of remembering ten small details.

A **shell script** is a repeatable sequence of terminal commands saved in a text file. Instead of typing the same release, backup, validation, or cleanup steps by hand, you put the commands in one file and let Bash run them in order.

Bash is a good fit for this layer because it orchestrates other programs. It calls `systemctl`, `curl`, `rsync`, `tar`, `journalctl`, `nginx -t`, and package tools. Larger business logic belongs in a language with stronger data structures and tests, but server glue often belongs in Bash because Linux servers already have it.

## What a Shell Script Is
<!-- section-summary: A shell script is a text file of commands that Bash executes in order. -->

One command you already trust can turn into the first script. A health check is a good example: the same URL, the same flags, the same success-or-failure decision after every deploy. Saving that command in a file gives you the smallest useful script.

A **shell script** is a plain text file containing commands for a shell to run. Bash reads the file from top to bottom, expands variables, runs commands, checks exit codes, and moves to the next line.

The smallest useful script might check a local health endpoint. The file content can be only one command:

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/health
```

Save that as `check-app.sh`. Run it through Bash:

```bash
bash check-app.sh

# Example output:
# ok
```

This is already useful. The command returns success only when the service responds with a successful HTTP status. A deployment script can use that fact after restarting the service.

The `curl` flags make the command script-friendly:

- `--fail` returns a nonzero exit code for HTTP error responses such as `500`.
- `--silent` hides the progress meter so logs stay readable.
- `--show-error` still prints the error message when the request fails.

If the service is down, the same script may print an error:

```bash
bash check-app.sh

# Example output:
# curl: (7) Failed to connect to 127.0.0.1 port 8080 after 0 ms: Couldn't connect to server
```

That error is good for automation. The script should fail loudly so a deploy step can stop before it marks a broken release as successful.

As scripts grow, the goal is clarity. A good operations script makes the important paths, service names, and checks obvious. A future engineer should be able to open the file and understand which machine state it changes.

## Shebang, Execute Bit, and `PATH`
<!-- section-summary: The shebang tells Linux which interpreter runs the script, and the execute bit allows direct execution. -->

After `bash check-app.sh` works, the natural next step is running a script directly as `./deploy.sh`. At that point Linux needs to know which interpreter should run the text file. The first line handles that:

```bash
#!/usr/bin/env bash
```

The `#!` sequence is the **shebang**. It tells the kernel to start the program that follows and pass the script file to it. `/usr/bin/env bash` asks the environment to find `bash` using `PATH`, which helps when Bash lives in a different location across systems.

The shebang exists because a script file is just text until an interpreter reads it. The kernel sees the execute bit, opens the first line, and uses the shebang path to start the right program. After that, Bash reads the script and handles variables, tests, loops, and command expansion.

The file also needs execute permission:

```bash
chmod +x scripts/deploy.sh
```

Check the permission:

```bash
ls -l scripts/deploy.sh

# Example output:
# -rwxr-xr-x 1 deploy web 1842 Jun 24 09:30 scripts/deploy.sh
```

The `x` in the owner, group, and others positions means those classes can execute the script. Some teams choose a narrower mode such as `750` when only the deploy user and service group should run it.

Now run the script with an explicit relative path:

```bash
./scripts/deploy.sh

# Example output:
# usage: deploy.sh /path/to/release.tar.gz
```

The `./` prefix matters. Your shell searches the directories listed in `PATH` when you type a bare command name. The current directory usually is not in `PATH` for security reasons, so `./scripts/deploy.sh` gives the shell an explicit path.

`PATH` is an ordered list of directories. When you type `nginx`, the shell checks each directory in `PATH` until it finds an executable named `nginx`. That lookup explains why two servers can run different binaries for the same command name. Use `command -v name` when the exact binary matters.

Running the same script with Bash asks Bash to read it directly:

```bash
bash scripts/deploy.sh
```

That form can work even before the execute bit is set, because `bash` is the program being executed and the script is its input file.

A team can place stable admin scripts in `/usr/local/sbin` or `/usr/local/bin`, then call them by name. For a small server, keeping scripts in `/srv/web/scripts` may be enough as long as the deployment procedure uses the full path.

The production symptom is "the script works over SSH and fails in CI." CI may have a smaller `PATH`, a different shell, or no execute bit on the checked-out file. The next decision is to call the script through an explicit path, keep the shebang accurate, and print `command -v` for required tools during debugging.

![Script execution path infographic showing shebang, execute bit, PATH lookup, and direct script execution](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/script-execution-path.png)

_The image shows the chain that lets a text file run like a command._

## Variables and Quoting
<!-- section-summary: Bash variables store strings, and quoting keeps those strings as one argument after expansion. -->

The first script may work perfectly until a path contains a space. A release directory named `/srv/web/releases/2026-06-24 09-30` may look harmless to a person. Unquoted Bash variables can split that path into two separate words.

Bash variables are strings. They hold paths, service names, URLs, release versions, and command output. Assignment has no spaces around the equals sign:

```bash
app_name="web"
service_name="app.service"
app_dir="/srv/web"
health_url="http://127.0.0.1:8080/health"
```

Values are read with `$name` or `${name}`. The braced form is clearer when text touches the variable:

```bash
log_file="/var/log/${app_name}/deploy.log"
```

Quoting is the daily safety rule. Use `"$app_dir"` when passing a variable to a command. Without quotes, Bash splits the expanded value on whitespace and expands wildcard characters. With quotes, the value stays one argument.

Quoting exists because Bash builds a command in stages before it runs a program. It expands variables, splits unquoted text into words, expands wildcards, then passes the final argument list to the command. Quotes tell Bash that the expanded value should stay together as one argument.

This script fragment handles a release directory whose name contains spaces:

```bash
release_dir="/srv/web/releases/2026-06-24 09-30"

mkdir -p "$release_dir"
tar -xzf "$HOME/releases/web.tar.gz" -C "$release_dir"
```

If you want to see the difference, print the value:

```bash
printf '<%s>\n' "$release_dir"

# Example output:
# </srv/web/releases/2026-06-24 09-30>
```

The whole path stayed one argument. That is what you want when a command creates or reads a directory.

Command substitution stores command output in a variable:

```bash
release_id=$(date +%Y%m%d-%H%M%S)
current_commit=$(git -C "$app_dir" rev-parse --short HEAD)
```

Print those values when debugging:

```bash
printf 'release=%s commit=%s\n' "$release_id" "$current_commit"

# Example output:
# release=20260624-093015 commit=4f8a2c1
```

The same quoting rule applies after substitution. Store the value, quote it when used, and avoid relying on luck when a path or branch name contains a surprising character.

The production symptom is a cleanup loop that works for normal names and breaks on a release directory with a space. The next decision is to quote every variable expansion unless you intentionally need word splitting, and to test scripts with paths that contain spaces before adding deletion commands.

![Quoted variable splitting infographic showing an unquoted release path breaking into words and a quoted path staying whole](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/quoted-variable-splitting.png)

_The image shows why quotes protect paths and arguments before a script reaches production data._

## Exit Codes and Branching
<!-- section-summary: Scripts make decisions from exit codes, where `0` means success and nonzero values represent failure. -->

After variables hold the important paths and URLs, the script has to decide whether each step worked. Printed output alone is not enough. A health endpoint may print an error page, `curl` may print a connection error, or a command may produce no output at all. The script needs a small machine-readable signal that says whether the step worked.

Every Linux command returns an **exit code**. `0` means success. Any nonzero value means the command failed in some way. Bash stores the last exit code in `$?`, and `if` statements use command success directly.

Exit codes exist so programs can report success or failure to the caller without requiring a human to inspect printed output. Bash uses those numbers for `if`, `&&`, `||`, and script failure handling. A command may print a warning and still return `0`, or print a useful error and return a nonzero value, so scripts should make decisions from exit codes first.

For service checks, the branch can stay simple:

```bash
if curl --fail --silent --show-error "$health_url"; then
    echo "Service health check passed"
else
    echo "Service health check failed"
    exit 1
fi
```

Example output when the service is healthy:

```console
ok
Service health check passed
```

Example output when the service is not healthy:

```console
curl: (22) The requested URL returned error: 500
Service health check failed
```

The `[[ ... ]]` syntax handles tests inside Bash:

```bash
config_file="/etc/nginx/sites-enabled/web.conf"

if [[ -f "$config_file" && -r "$config_file" ]]; then
    echo "Nginx site config is readable"
else
    echo "Missing or unreadable config: $config_file"
    exit 1
fi

# Example output:
# Nginx site config is readable
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

That command-and-result rhythm is the core of shell scripting. Run a command, check whether it succeeded, then choose the next step.

The production symptom of ignored exit codes is a deploy that restarts a service even after extraction failed. The next decision is to make failure stop the script near the broken command and print enough context for the operator to know which check failed.

## A Safer Deploy Script
<!-- section-summary: A production script should fail early, name important paths, validate services, and leave a clear rollback clue. -->

Now put the pieces together in a deploy script. Shell scripts are powerful because they can change files, restart services, and move releases forward with one command. That also means a small mistake can keep running after the real failure already happened. A missing variable can turn into an empty path. A failed command in the middle of a pipeline can be hidden by a later successful command.

The first production-grade habit is adding strict mode near the top:

```bash
set -euo pipefail
```

`set -e` exits when a command fails. `set -u` exits when the script reads an unset variable. `pipefail` makes a pipeline fail when any command inside it fails, rather than only the final command. These settings help scripts stop near the real problem.

Strict mode exists to turn silent script mistakes into early failures. An unset variable such as `$release_dir` should stop the script instead of expanding to an empty string. A failed `grep` inside a pipeline should not be hidden by a successful `tail`. The next decision after enabling strict mode is to handle expected failures explicitly with `if`, `case`, or `|| true` only where the failure is truly acceptable.

A small deploy script can look like this:

```bash
#!/usr/bin/env bash
set -euo pipefail

service_name="app.service"
app_dir="/srv/web"
release_archive="${1:?usage: deploy.sh /path/to/release.tar.gz}"
release_id=$(date +%Y%m%d-%H%M%S)
release_dir="${app_dir}/releases/${release_id}"
current_link="${app_dir}/current"
health_url="http://127.0.0.1:8080/health"

mkdir -p "$release_dir"
tar -xzf "$release_archive" -C "$release_dir"

ln -sfn "$release_dir" "$current_link"

sudo systemctl restart "$service_name"
sleep 2

curl --fail --silent --show-error "$health_url" >/dev/null
sudo nginx -t
sudo systemctl reload nginx

echo "Deployed ${service_name} release ${release_id}"
```

The first block names the values a reviewer needs to check before trusting the script:

- `service_name="app.service"` names the systemd unit the script restarts.
- `app_dir="/srv/web"` names the application root that should contain releases and the active symlink.
- `release_archive="${1:?usage: deploy.sh /path/to/release.tar.gz}"` requires the caller to pass an archive path. If the argument is missing, Bash prints the usage message and exits.
- `release_id=$(date +%Y%m%d-%H%M%S)` creates a timestamp that makes each release directory unique.
- `release_dir="${app_dir}/releases/${release_id}"` builds the destination path for the extracted release.
- `current_link="${app_dir}/current"` names the symlink the service should use as the active release.
- `health_url="http://127.0.0.1:8080/health"` keeps the local health check in one reviewable place.

The operational lines protect the deploy flow after the archive is extracted:

- `ln -sfn "$release_dir" "$current_link"` atomically points `current` at the new release path. The `-s` flag creates a symlink, `-f` replaces an existing destination, and `-n` treats an existing symlink as a link rather than following it as a directory.
- `sleep 2` gives the restarted service a short moment to bind its port before the health check runs.
- `curl --fail --silent --show-error "$health_url" >/dev/null` checks the response but discards the response body. The `>/dev/null` redirect keeps successful HTML or JSON out of the deploy log while still allowing errors to print.

Run it with a release archive:

```bash
./scripts/deploy.sh /home/deploy/releases/web.tar.gz

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
# Deployed app.service release 20260624-093015
```

The symlink pattern gives the server a simple release structure. Each release gets its own directory under `/srv/web/releases`, and `/srv/web/current` points at the active one. Rollback can point the symlink back to the previous release, restart the service, and rerun the health check.

The middle of the script does the operational work:

- `mkdir -p "$release_dir"` creates the release directory and does not fail if the parent path already exists.
- `tar -xzf` extracts a gzip-compressed archive into that directory.
- `ln -sfn` updates the `current` symlink to point at the new release path.
- `systemctl restart` restarts the application service so it picks up the new code.
- `nginx -t` validates Nginx configuration before the reload command touches the running proxy.

This script assumes the unit file uses `/srv/web/current` as its working directory. Scripts and service files need to agree on paths. The next system administration articles connect Bash with systemd and process inspection.

![Bash safety flags infographic showing errexit, nounset, pipefail, explicit checks, and useful error output](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/bash-safety-flags.png)

_The image turns the common safety options into a small script reliability checklist._

## Functions, `trap`, and Cleanup
<!-- section-summary: Functions group repeated work, and traps run cleanup or diagnostics when a script exits. -->

After a deploy script works once, it often grows by copy and paste. The same health check appears after restart and after rollback. The same log message appears before several commands. At the same time, the script may create a temporary directory or update a symlink that needs cleanup if the run fails halfway through.

Functions solve the repeated-code part by giving a name to a group of commands. A deploy script might have separate functions for validation, health checks, and rollback hints:

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

The functions keep repeated actions named and reviewable:

- `log()` prints a timestamped message so deploy logs show when each step happened.
- `check_health()` runs the same health check every time and discards the response body with `>/dev/null` because only the success or failure matters.
- `validate_nginx()` keeps the Nginx syntax test in one place, which reduces copy-paste mistakes when the script grows.

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

The loop has a clear retry contract:

- `local attempt` keeps the counter scoped to `wait_for_health`.
- `for attempt in {1..10}; do` tries the health check ten times.
- `if check_health; then return 0; fi` returns success as soon as the application responds correctly.
- `sleep 1` waits one second between attempts so the service has time to finish startup.
- `return 1` reports failure after all attempts are used.

`trap` registers a command to run when the script receives a signal or exits. This is useful for cleanup and diagnostics:

```bash
on_error() {
    local exit_code=$?
    echo "Deploy failed with exit code ${exit_code}"
    echo "Recent service logs:"
    journalctl -u app.service --no-pager -n 30
    exit "$exit_code"
}

trap on_error ERR
```

The trap example preserves the original failure while adding context:

- `local exit_code=$?` captures the command failure that triggered the trap.
- `journalctl -u app.service --no-pager -n 30` prints the last 30 service log lines without opening a pager.
- `exit "$exit_code"` exits with the original failure code so automation still sees the deploy as failed.
- `trap on_error ERR` runs `on_error` whenever a command fails under strict mode.

With this trap, a failed health check prints recent service logs before the script exits. That is practical production polish: the script fails with the first clue already attached.

Traps exist because scripts often create temporary files, update symlinks, or start work that needs cleanup. A trap can remove a temp directory on exit, print diagnostics on error, or restore state after an interrupted run. Keep trap functions small because they run during failure paths, where the script is already under stress.

Example output from a failed deploy might look like this:

```console
Deploy failed with exit code 22
Recent service logs:
Jun 24 09:31:02 server01 app[1842]: failed to connect to database
Jun 24 09:31:03 server01 app[1842]: shutting down
```

The exit code tells automation that the script failed. The recent logs give the human the first place to inspect.

![Trap cleanup lifecycle infographic showing temporary directory creation, work, error, cleanup trap, and final exit](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/trap-cleanup-lifecycle.png)

_The image shows how `trap` keeps cleanup attached to every exit path, including failures._

## Loops and Safe File Handling
<!-- section-summary: Loops repeat checks across files or hosts, and null-delimited file lists handle awkward filenames safely. -->

The last beginner scripting step is repetition inside the script itself. Manual checks get old quickly when the same question applies to several targets. A release may need to check the local health URL, the public Nginx URL, and a small list of files before it continues.

Loops let a script repeat one operation across a known list. A health script may check the local service and the public Nginx endpoint:

```bash
for url in "http://127.0.0.1:8080/health" "https://example.com/health"; do
    if curl --fail --silent --show-error "$url" >/dev/null; then
        echo "ok: $url"
    else
        echo "failed: $url"
        exit 1
    fi
done

# Example output:
# ok: http://127.0.0.1:8080/health
# ok: https://example.com/health
```

The loop reads like a small checklist:

- `for url in ...; do` creates one loop run for the local health endpoint and one for the public health endpoint.
- `curl --fail --silent --show-error "$url" >/dev/null` treats bad HTTP responses as failures, hides successful response bodies, and still prints useful error text.
- `echo "ok: $url"` records which endpoint passed.
- `echo "failed: $url"` records the endpoint that failed.
- `exit 1` stops the script on the first failed endpoint so later deploy steps do not continue after a broken health check.
- `done` closes the loop after every URL has been checked.

When looping over files from `find`, filenames may contain spaces, quotes, or newlines. The safer pattern uses null-delimited output from `find -print0` and reads it with `read -d ''`:

```bash
find /srv/web/releases -maxdepth 1 -type d -mtime +14 -print0 |
while IFS= read -r -d '' old_release; do
    echo "Old release candidate: $old_release"
done

# Example output:
# Old release candidate: /srv/web/releases/20260601-091500
# Old release candidate: /srv/web/releases/20260605-174200
```

The script above only prints candidates. A real cleanup script should also keep the active `current` target, keep at least one previous release, and log what it removes. Deleting files in automation deserves extra care because a small path bug can remove the wrong tree.

Null-delimited loops exist because newline-delimited file lists cannot safely represent every valid filename. The under-the-hood idea is simple: `find -print0` separates names with the zero byte, and normal path names cannot contain that byte. The next decision before deletion is to print candidates first, compare them with the active symlink, then add `rm -rf -- "$old_release"` only after review.

Shell scripting grows from one repeated command. Add variables for important paths, quote expansions, check exit codes, group repeated behavior into functions, and print useful diagnostics when the script stops.

![Shell scripting summary infographic showing shebang, quoting, exit codes, functions, traps, loops, and safe file handling](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/shell-scripting-summary.png)

_The summary image gathers the scripting habits that keep small automation readable and safe._

## References

- [GNU Bash manual](https://www.gnu.org/software/bash/manual/bash.html) - Official Bash reference for shell syntax, expansion, variables, and execution.
- [Bash conditional expressions](https://www.gnu.org/software/bash/manual/html_node/Bash-Conditional-Expressions.html) - Documents `[[ ... ]]` test operators.
- [Bash shell parameter expansion](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html) - Documents `${var}`, default values, and required-argument expansion.
- [Bash `set` builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html) - Documents `-e`, `-u`, and related shell options.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents service restart and reload behavior used by scripts.
- [Nginx command-line parameters](https://nginx.org/en/docs/switches.html) - Documents `nginx -t` for configuration validation.
