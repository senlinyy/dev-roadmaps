Run `vim check.sh`, press `i` to enter Insert mode, type your script, then `Esc` followed by `:wq` to save and quit. Repeat for `servers.sh`.

---

For the if/else, the structure is: `if [[ -f "/etc/hostname" ]]; then ... else ... fi`. For the for loop: `for server in web01 web02 web03; do ... done`. Use `echo "Checking ${server}..."` inside the loop body.
