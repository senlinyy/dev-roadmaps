---
title: "Shell Scripting"
description: "Write Bash scripts with variables, conditionals, loops, and functions to automate repetitive server tasks."
overview: "Write practical Bash scripts for Linux operations: deploy a release, validate Nginx, run health checks, and fail loudly when a step goes wrong."
tags: ["bash", "variables", "loops"]
order: 3
id: article-devops-foundation-linux-linux-basics-shell-scripting
---

## Table of Contents

1. [Why Does Repeated Shell Work Become a Script?](#why-does-repeated-shell-work-become-a-script)
2. [What Actually Runs a Shell Script?](#what-actually-runs-a-shell-script)
3. [How Do the Shebang, Execute Bit, and PATH Select Execution?](#how-do-the-shebang-execute-bit-and-path-select-execution)
4. [How Do Expansion, Quoting, Arguments, and Environment Values Work?](#how-do-expansion-quoting-arguments-and-environment-values-work)
5. [How Do Exit Codes, Tests, and Pipelines Control Decisions?](#how-do-exit-codes-tests-and-pipelines-control-decisions)
6. [How Do You Build a Safer and Repeatable Deploy Script?](#how-do-you-build-a-safer-and-repeatable-deploy-script)
7. [How Do Functions, Temporary Files, Signals, and Traps Bound Cleanup?](#how-do-functions-temporary-files-signals-and-traps-bound-cleanup)
8. [How Do You Iterate over Input Without Turning Data into Shell Syntax?](#how-do-you-iterate-over-input-without-turning-data-into-shell-syntax)
9. [Check Your Answers](#check-your-answers)

After you can navigate the filesystem and edit a config file, the next problem is repetition. A deploy over SSH often turns into the same chain of commands: pull a release artifact, install dependencies, restart a service, validate Nginx, check a health endpoint, and inspect logs when something fails.

Typing those steps manually works once. The risk grows when the team deploys every day or when someone repairs a server during an incident. A shell script captures the known sequence so the operator runs one reviewed command instead of remembering ten small details.

A **shell script** is a repeatable sequence of terminal commands saved in a text file. Instead of typing the same release, backup, validation, or cleanup steps by hand, you put the commands in one file and let Bash run them in order.

Keep these questions in view as you work through the lesson:

1. **Why Does Repeated Shell Work Become a Script?**
2. **What Actually Runs a Shell Script?**
3. **How Do the Shebang, Execute Bit, and `PATH` Select Execution?**
4. **How Do Expansion, Quoting, Arguments, and Environment Values Work?**
5. **How Do Exit Codes, Tests, and Pipelines Control Decisions?**
6. **How Do You Build a Safer and Repeatable Deploy Script?**
7. **How Do Functions, Temporary Files, Signals, and Traps Bound Cleanup?**
8. **How Do You Iterate over Input Without Turning Data into Shell Syntax?**

## Why Does Repeated Shell Work Become a Script?
<!-- section-summary: Shell scripts turn repeated server operations into reviewed, repeatable commands. -->

Bash is a good fit for this layer because it orchestrates other programs. It calls `systemctl`, `curl`, `rsync`, `tar`, `journalctl`, `nginx -t`, and package tools. Larger business logic belongs in a language with stronger data structures and tests, but server glue often belongs in Bash because Linux servers already have it.

## What Actually Runs a Shell Script?
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

The shell is both an interpreter and a process orchestrator. Some commands, such as `cd`, `export`, `read`, and `printf`, may be shell **builtins** because they need to affect shell state or are efficient to implement internally. Other command names resolve to executable files, and Bash creates child processes to run them. A script often coordinates many such children and turns their statuses and output into one higher-level operation.

Running `bash check-app.sh` normally creates a child Bash process. Changes to its current directory, shell variables, options, and functions disappear when that child exits. The parent shell receives only the script's exit status and whatever output or files the script produced.

`source settings.sh`, also written `. settings.sh`, is different: it reads commands into the current shell. A sourced file can change the caller's variables, functions, options, and directory. That is useful for deliberately loading shell definitions and dangerous when the file is untrusted or unexpectedly calls `exit`. Prefer executing operational scripts as children; source only files whose purpose is to modify the current shell.

## How Do the Shebang, Execute Bit, and `PATH` Select Execution?
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

## How Do Expansion, Quoting, Arguments, and Environment Values Work?
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

Single and double quotes preserve different kinds of text. Single quotes keep every character literal, while double quotes allow parameter expansion, command substitution, and selected escapes:

```bash
name="web"
printf '%s\n' '$name'    # prints $name
printf '%s\n' "$name"    # prints web
```

Arguments supplied to a script become positional parameters. `$0` identifies how the script was invoked, `$1` is the first argument, `$#` is the argument count, and `"$@"` expands every supplied argument while preserving each as a separate word. That last form is the safe way to forward arbitrary arguments:

```bash
#!/usr/bin/env bash

if (( $# < 1 )); then
    printf 'usage: %s RELEASE_ARCHIVE [extra tar options...]\n' "$0" >&2
    exit 64
fi

archive=$1
shift
tar -xzf "$archive" "$@"
```

Do not replace `"$@"` with `$*` or an unquoted expansion. The original caller may have supplied an argument containing spaces or wildcard characters, and the script should pass the same argument boundaries onward.

Environment variables are exported name-value pairs inherited by child processes. A normal shell variable remains inside the current shell; `export APP_ENV=production` makes the value available to commands the shell starts. A child can inherit or override a value for its descendants, but it cannot normally rewrite the parent's environment after it exits.

Parameter expansion can supply defaults and enforce required configuration without a separate branch:

```bash
app_dir=${APP_DIR:-/srv/web}
release_id=${RELEASE_ID:?RELEASE_ID must be set}
log_level=${LOG_LEVEL:=info}
```

`${APP_DIR:-/srv/web}` uses the default when `APP_DIR` is unset or empty. `${RELEASE_ID:?...}` stops expansion with an error when the required value is absent. `${LOG_LEVEL:=info}` also assigns the default in the current shell. These forms are compact, so use names and messages that make the contract obvious.

Arrays preserve a list of argument boundaries. They are safer than building one command string and asking the shell to parse it again:

```bash
curl_args=(--fail --silent --show-error --connect-timeout 3)
curl_args+=(--header "X-Release: $release_id")
curl "${curl_args[@]}" "$health_url"
```

Input is data, not shell syntax. Avoid `eval` and command strings assembled from user input. An array gives the target program the intended arguments without turning spaces, semicolons, substitutions, or wildcards inside values into a second layer of shell code.

![Quoted variable splitting infographic showing an unquoted release path breaking into words and a quoted path staying whole](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/quoted-variable-splitting.png)

_The image shows why quotes protect paths and arguments before a script reaches production data._

## How Do Exit Codes, Tests, and Pipelines Control Decisions?
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

Short-circuit operators use the same statuses. `build && deploy` runs `deploy` only after a successful build. `check || recover` runs `recover` only after a failed check. They are useful when the relationship is simple; a named `if` block is clearer when failure needs logging, cleanup, or several recovery steps.

Pipelines connect the standard output of one process to the standard input of the next:

```bash
journalctl -u app.service --since '10 minutes ago' | grep -F 'ERROR' | tail -20
```

Without extra handling, Bash normally reports the status of the last pipeline command. An earlier command can fail while `tail` succeeds. A common Bash safety baseline is:

```bash
set -euo pipefail
```

- `-e` asks Bash to exit after many unhandled command failures, although conditions, short-circuit lists, functions, and substitutions have important exceptions.
- `-u` treats an unset variable expansion as an error, which catches misspelled configuration names.
- `pipefail` makes a pipeline fail when any component fails rather than considering only the last command.

These options strengthen a script; they do not replace explicit checks. Commands can return nonzero for an expected condition, and cleanup still needs a trap. Put expected failures inside `if`, `while`, or a deliberate `||` branch so the script documents that status as data rather than an accident.

Tests are commands too. `[[ -f "$path" ]]` returns a status that `if` consumes. External tools also define their own status contracts: `grep` commonly returns `1` for no match and values above `1` for an actual error. Read the contract before treating every nonzero code as the same failure.

## How Do You Build a Safer and Repeatable Deploy Script?
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

A safe deploy script validates every assumption that matters before mutation: the archive is a readable regular file, required tools resolve through `PATH`, the target filesystem has space, the service name is expected, and the current release can be identified for recovery. Divide the operation into stages such as validate, prepare, activate, verify, and clean up. When the verify stage fails, the script should leave enough state and evidence to select or restore the previous release.

Idempotence means repeating the script against the same intended state does not accumulate unintended changes. `mkdir -p` already expresses that property. Replacing a symlink with the same target should also settle cleanly. Appending a configuration line on every run is not idempotent; checking or rendering the desired file first is safer. Shell automation is largely state management: observe current state, decide whether a transition is necessary, perform the narrow transition, and verify the result.

Configuration changes deserve their own candidate-and-validation boundary. Write or render a candidate to a temporary file, run the service's parser against it, install it atomically only after success, then reload when the service supports reload. Restarting first and discovering invalid syntax afterward reverses the safe order.

![Bash safety flags infographic showing errexit, nounset, pipefail, explicit checks, and useful error output](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/bash-safety-flags.png)

_The image turns the common safety options into a small script reliability checklist._

## How Do Functions, Temporary Files, Signals, and Traps Bound Cleanup?
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

Create temporary paths with `mktemp` instead of guessing a name in `/tmp`. Guessable names can collide with another run or be pre-created by another user. Register cleanup immediately after creation so every later exit path is covered:

```bash
tmp_dir=$(mktemp -d)
cleanup() {
    rm -rf -- "$tmp_dir"
}
trap cleanup EXIT HUP INT TERM

candidate="$tmp_dir/nginx.conf"
render_config >"$candidate"
sudo nginx -t -c "$candidate"
```

`EXIT` handles normal and error exits. `HUP`, `INT`, and `TERM` cover common termination signals, although a process cannot trap `KILL`. The `--` before the path ends option parsing so a value beginning with `-` is still treated as an operand. Capture important status values before running diagnostic or cleanup commands, because each later command replaces `$?`.

Functions return statuses like other commands. `return 0` reports success to the caller; a nonzero return lets `if check_health` choose a recovery path. Function arguments use their own `$1`, `$#`, and `"$@"`, while variables are global unless declared `local`. Keeping inputs explicit makes functions easier to test and prevents one stage from accidentally overwriting another stage's state.

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

## How Do You Iterate over Input Without Turning Data into Shell Syntax?
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

Avoid `for file in $(find ...)`. Command substitution removes trailing newlines, and the unquoted result is split and glob-expanded, so one filename can become several loop items. A simple glob is safe when one directory level is enough:

```bash
for file in /srv/web/releases/*; do
    [[ -e "$file" ]] || continue
    printf '%s\n' "$file"
done
```

For recursive traversal, keep the null delimiter or let `find -exec ... {} +` pass paths as arguments directly. Use `read -r` so backslashes remain data, and set `IFS=` so leading and trailing whitespace is preserved. Quote every filename expansion and place `--` before operands for commands that support it.

Use shell for orchestration where processes, files, and command statuses are the main model. Move to Python or another general-purpose language when the work needs nested data structures, complex parsing, concurrency, or substantial business logic. Decide whether the script requires Bash features such as arrays and `[[ ... ]]`; if so, declare Bash in the shebang rather than labeling it portable `sh`.

Static analysis and trace output help before production. `shellcheck scripts/deploy.sh` catches common quoting, test, and expansion mistakes. `bash -n scripts/deploy.sh` checks syntax without executing. `set -x` prints expanded commands for debugging, but it can expose secret values in logs; enable it only around nonsecret work or use a controlled debug mode. Secrets should not be placed casually in command-line arguments because process listings and audit records may preserve them.

Prompts also need context. An interactive confirmation can protect a human cleanup command and can hang unattended CI forever. Prefer an explicit `--dry-run` that prints intended changes and a separate noninteractive approval flag for automation. The caller should be able to tell whether the script is observing, planning, or mutating state.

The deeper reason is that the shell does not pass a command-line string to most programs. It constructs an argument vector. Quoting controls how source text becomes those arguments, and the receiving program sees only the finished values. Compare the two calls:

```bash
name='quarterly report.txt'
printf '<%s>\n' $name
printf '<%s>\n' "$name"
```

The unquoted expansion can become two arguments, while the quoted expansion remains one. Globbing happens after word splitting, so an unquoted value containing `*` may also expand into filenames. Quoting `"$variable"` and `"$@"` preserves the data boundary; it is not decoration around a string.

Command substitution has another boundary. `result=$(command)` captures standard output but removes trailing newline characters. It does not capture standard error, and it cannot preserve an arbitrary null byte inside a Bash variable. Use command substitution for a small textual value such as an identifier, not as a container for an unbounded file list. Arrays, a loop that reads a stream, or a temporary file preserve structure more clearly.

`IFS` controls some splitting and `read` behavior. Changing it globally can alter later expansions in surprising ways. Keep a change local to the command that needs it:

```bash
while IFS= read -r line; do
  printf 'received: %s\n' "$line"
done < "$input_file"
```

`IFS=` prevents leading and trailing whitespace from being trimmed, and `-r` prevents backslashes from becoming escape characters. This loop still treats newline as a record boundary, so it is appropriate only when that is the input contract.

Failure handling also needs an explicit model. `set -e` does not mean “every nonzero status always exits.” Shell grammar contains contexts—tests in `if`, parts of `&&` and `||` lists, and other conditional positions—where failure is being inspected rather than treated as fatal. Make expected alternatives visible:

```bash
if ! nginx -t; then
  log 'candidate Nginx configuration is invalid'
  return 1
fi

if grep -q '^maintenance=true$' "$env_file"; then
  log 'maintenance mode is enabled'
fi
```

The first failure is an error that stops the stage. The second command uses `grep` as a question: status `0` means the line exists, `1` means it does not, and a larger status means an actual grep error. When these meanings differ, capture and interpret the status rather than relying on a blanket option.

Pipelines add multiple process statuses. With `pipefail`, the pipeline is nonzero if a stage fails, but you may still need to know which one. Bash exposes the statuses through `PIPESTATUS` immediately after the pipeline:

```bash
producer | validator | consumer
pipeline_status=("${PIPESTATUS[@]}")
printf 'producer=%s validator=%s consumer=%s\n' "${pipeline_status[@]}"
```

Copy the array immediately because the next command changes it. In a critical workflow, separate stages or use temporary artifacts when each status and intermediate result must be independently inspected.

Cleanup must preserve the original result. A trap that fails can otherwise replace or obscure the status of the work that triggered it. Capture `$?` first, disable recursive traps, perform best-effort cleanup, and exit with the saved status:

```bash
tmp_dir=''

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n $tmp_dir && -d $tmp_dir ]]; then
    rm -rf -- "$tmp_dir"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM
tmp_dir=$(mktemp -d)
```

Register the trap immediately after the resource exists. Keep the target initialized, quoted, and checked so an unset or unexpectedly broad value never becomes a removal path. For a temporary file, `mktemp` provides a non-predictable name and creates the object atomically; hand-built names in `/tmp` can race with another process.

Signals are requests delivered asynchronously. `SIGINT` may come from an interactive interrupt, `SIGTERM` from a service manager, and `SIGHUP` from a lost terminal or application-specific reload convention. A trap should make cleanup bounded and safe, but it cannot make every command transactional. `SIGKILL` cannot be trapped, and a machine failure can occur between any two commands. Design persistent changes so recovery does not depend only on the cleanup function running.

That matters during publishing. Create and validate a release under a unique temporary or versioned path. Only after validation should one small operation expose it as current. If the script dies before the switch, users continue to see the old release; if it dies afterward, the new release is already complete. Avoid copying files one by one into the live directory, where interruption can expose a mixture of versions.

Concurrency is another form of state. Two correct deploy scripts can conflict when they run at the same time. A lock states that only one publisher may change the active release:

```bash
lock_file=/run/lock/web-deploy.lock
exec 9>"$lock_file"
if ! flock -n 9; then
  die 'another deployment is already running'
fi
```

The open file descriptor holds the lock for the process. The script still needs permission to create or open the lock file, and every competing publisher must honor the same convention. A lock does not replace validation, idempotence, or atomic publication; it protects the shared transition from concurrent writers.

Idempotence means the requested state can be applied again without accumulating unintended changes. `mkdir -p` is idempotent for a directory's existence. Repeatedly appending a configuration line with `>>` is not: every run adds another copy. Check the current state, create a full candidate, validate it, and replace the destination only when needed. Distinguish a safe repeated outcome from merely ignoring errors with `|| true`.

Secrets deserve separate handling. Command-line arguments can appear in process listings and logs. `set -x` prints expanded commands, so tracing a line containing a token may disclose it. Prefer a protected file descriptor, a service credential mechanism, or a permissions-restricted configuration file supported by the receiving program. Disable tracing around secret reads, and never place the secret in an error message.

Interactive confirmation is also an interface decision. A prompt that waits forever breaks scheduled automation. Accept an explicit flag such as `--yes`, refuse dangerous operations when a terminal is absent, or make the safe default do nothing. When reading from a user, read from the terminal deliberately rather than consuming data that was supposed to be piped into the script.

A reviewable shell program separates five responsibilities:

1. Constants and defaults name the external state the script may touch.
2. Argument parsing and validation reject missing, contradictory, or malformed input before mutation.
3. Logging and error helpers make each transition visible without leaking secrets.
4. Worker functions perform one stage and return a meaningful status.
5. `main` orders the stages, while traps own bounded cleanup.

This structure makes a script read like an operational plan. It also makes the decision to outgrow shell clearer. When data structures become nested, concurrency becomes central, error recovery becomes transactional, or portability across shells dominates the work, a general-purpose language may provide safer types and libraries. Shell remains excellent when its job is to connect existing commands while preserving their argument, stream, status, and process boundaries.

The review question for every line is therefore concrete: which arguments will the receiver get, which streams are connected, which status is inspected, which shell or child state changes, and what happens if interruption occurs immediately afterward? A safe script makes those boundaries visible and keeps persistent mutations small, validated, repeatable, and recoverable.

Test those claims with representative data: empty values, spaces, leading dashes, wildcard characters, missing files, failed commands, partial setup, repeated execution, and concurrent execution when shared state exists. The happy path proves the script can work; boundary cases prove its quoting, status, cleanup, and idempotence model.

Keep the interpreter and required external commands explicit so another host does not silently run a different language or feature set.

### How Does a Complete Script Keep Its Responsibilities Visible?

A practical script can follow one predictable architecture: constants and inputs, logging and error helpers, cleanup registration, validation, worker functions, and one `main` function. Calling `main "$@"` at the end makes the entry point explicit and prevents top-level setup from becoming an accidental sequence nobody can test separately.

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly app_dir=${APP_DIR:-/srv/web}
readonly keep_releases=${KEEP_RELEASES:-5}
dry_run=false
tmp_dir=

log() {
    printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    local status=$?
    if [[ -n ${tmp_dir:-} && -d $tmp_dir ]]; then
        rm -rf -- "$tmp_dir"
    fi
    exit "$status"
}

usage() {
    printf 'usage: %s [--dry-run]\n' "$0"
}

parse_args() {
    while (( $# > 0 )); do
        case $1 in
            --dry-run) dry_run=true ;;
            -h|--help) usage; exit 0 ;;
            --) shift; break ;;
            *) die "unknown argument: $1" ;;
        esac
        shift
    done
}

validate() {
    [[ -d $app_dir/releases ]] || die "missing releases directory: $app_dir/releases"
    [[ $keep_releases =~ ^[0-9]+$ ]] || die 'KEEP_RELEASES must be a non-negative integer'
    command -v find >/dev/null || die 'find is required'
    command -v readlink >/dev/null || die 'readlink is required'
}

list_release_candidates() {
    find "$app_dir/releases" -mindepth 1 -maxdepth 1 -type d -print0
}

remove_release() {
    local release=$1
    if [[ $dry_run == true ]]; then
        printf 'would remove: %s\n' "$release"
    else
        rm -rf -- "$release"
        printf 'removed: %s\n' "$release"
    fi
}

main() {
    local current
    local release
    local -a candidates=()

    parse_args "$@"
    validate

    tmp_dir=$(mktemp -d)
    trap cleanup EXIT HUP INT TERM

    current=$(readlink -f "$app_dir/current")

    while IFS= read -r -d '' release; do
        [[ $release == "$current" ]] && continue
        candidates+=("$release")
    done < <(list_release_candidates)

    if (( ${#candidates[@]} <= keep_releases )); then
        log 'no old releases need removal'
        return 0
    fi

    mapfile -d '' candidates < <(
        printf '%s\0' "${candidates[@]}" |
        sort -z
    )

    for release in "${candidates[@]:0:${#candidates[@]}-keep_releases}"; do
        remove_release "$release"
    done
}

main "$@"
```

This example treats paths as array elements rather than one string. The null-delimited producer and `read -d ''` preserve unusual filenames. `--` stops `rm` option parsing. The current symlink target is excluded before any deletion decision, and dry-run changes the worker behavior without changing selection logic.

The script still has assumptions that deserve review. Lexical sorting works only because release directories use a sortable timestamp naming scheme. Concurrent cleanup runs could race, so a shared production job may need a lock such as `flock`. The number of retained releases is validated, but available disk space and rollback policy may require stronger checks. A robust script states those contracts instead of hiding them in a clever command.

Process substitution in `done < <(list_release_candidates)` keeps the `while` loop in the current shell, so additions to the `candidates` array remain visible afterward. A pipeline into `while` may run the loop in a subshell in Bash, causing variable changes to disappear. This child-shell rule is easy to miss and is another reason to keep stateful loops explicit.

The cleanup trap captures `$?` before testing or removing anything, then exits with the same status. Without that capture, a successful `rm` could replace the original error status and make a failed operation look successful. Cleanup should be safe when called after partial setup; testing whether `tmp_dir` is nonempty and exists makes it repeatable.

Logging also needs a secret boundary. Print the stage, target, and result, but do not print access tokens, passwords, private keys, or full environment dumps. `set -x` traces expanded values and can leak them even when the script never calls `echo`. Turn tracing off before secret-bearing commands and prefer passing secrets through protected files or file descriptors when the consuming tool supports them.

Run three cheap checks before trusting a script:

```bash
bash -n scripts/cleanup-releases.sh
shellcheck scripts/cleanup-releases.sh
scripts/cleanup-releases.sh --dry-run
```

Syntax checking proves only that Bash can parse the file. ShellCheck catches common static mistakes. Dry-run exercises real discovery and selection without applying deletion. A test directory containing spaces, leading dashes, an active symlink, and more releases than the retention limit provides stronger evidence than one happy-path filename.

Shell scripting grows from one repeated command. Add variables for important paths, quote expansions, check exit codes, group repeated behavior into functions, and print useful diagnostics when the script stops.

![Shell scripting summary infographic showing shebang, quoting, exit codes, functions, traps, loops, and safe file handling](/content-assets/articles/article-devops-foundation-linux-linux-basics-shell-scripting/shell-scripting-summary.png)

_The summary image gathers the scripting habits that keep small automation readable and safe._

## Check Your Answers

:::expand[Why Does Repeated Shell Work Become a Script?]{kind="recap"}
A script turns remembered terminal steps into reviewed process orchestration with one repeatable entry point and status.
:::

:::expand[What Actually Runs a Shell Script?]{kind="recap"}
An interpreter reads the text, builtins change shell state, and child processes perform most external operations.
:::

:::expand[How Do the Shebang, Execute Bit, and `PATH` Select Execution?]{kind="recap"}
The invocation path, execute permission, shebang, and executable search path together determine which interpreter and tools run.
:::

:::expand[How Do Expansion, Quoting, Arguments, and Environment Values Work?]{kind="recap"}
Bash expands text into arguments; quotes, arrays, positional parameters, and exported values preserve the intended boundaries.
:::

:::expand[How Do Exit Codes, Tests, and Pipelines Control Decisions?]{kind="recap"}
Commands report statuses that drive branches, while strict options and `pipefail` expose otherwise hidden failures.
:::

:::expand[How Do You Build a Safer and Repeatable Deploy Script?]{kind="recap"}
Validate assumptions, separate stages, make transitions idempotent, verify runtime health, and keep a recoverable previous state.
:::

:::expand[How Do Functions, Temporary Files, Signals, and Traps Bound Cleanup?]{kind="recap"}
Functions name status-producing work, `mktemp` creates safe scratch space, and traps attach cleanup to every reachable exit.
:::

:::expand[How Do You Iterate over Input Without Turning Data into Shell Syntax?]{kind="recap"}
Preserve input as quoted arguments, use null-delimited traversal for paths, and avoid reparsing data through command strings.
:::

### References

- [GNU Bash manual](https://www.gnu.org/software/bash/manual/bash.html) - Official Bash reference for shell syntax, expansion, variables, and execution.
- [Bash conditional expressions](https://www.gnu.org/software/bash/manual/html_node/Bash-Conditional-Expressions.html) - Documents `[[ ... ]]` test operators.
- [Bash shell parameter expansion](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html) - Documents `${var}`, default values, and required-argument expansion.
- [Bash `set` builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html) - Documents `-e`, `-u`, and related shell options.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents service restart and reload behavior used by scripts.
- [Nginx command-line parameters](https://nginx.org/en/docs/switches.html) - Documents `nginx -t` for configuration validation.
