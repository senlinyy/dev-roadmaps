Use `grep State /proc/*/status` to find the process in state `T (stopped)`. Once you know its PID, read its `environ` file with `cat` to find the signal.
