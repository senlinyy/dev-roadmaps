For the cleanup script, define the function first, then register it with `trap cleanup EXIT`. The trap must reference the function name, and `EXIT` is the pseudo-signal that fires when the script ends.

---

For safe file iteration, the pattern is `while IFS= read -r -d '' file; do ... done < <(find /var/log -name "*.log" -print0)`. The `-d ''` tells `read` to split on null bytes. `IFS=` prevents whitespace trimming. `-r` prevents backslash interpretation.
