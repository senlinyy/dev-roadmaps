Set the variable first with `APP=devpolaris` (no spaces around `=`). Then use `echo '...' > deploy.sh` and `echo '...' >> deploy.sh` to build the script line by line.

---

Use `${APP}_deploy` (with curly braces) so Bash knows the variable name is `APP`, not `APP_deploy`. Without braces, Bash looks for a variable called `APP_deploy` which does not exist.

---

Run with `bash deploy.sh` instead of `./deploy.sh`. The `bash` command inherits the current shell environment, so `$APP` is available inside the script.
