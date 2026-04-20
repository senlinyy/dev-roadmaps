Use `grep State /proc/*/status` to see the state of every process at once. Look for the `Z` state. Then use `grep VmRSS /proc/*/status` to compare memory usage across all processes.
