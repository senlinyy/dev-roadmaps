```bash
cat ready.txt missing.txt > output.log 2> errors.log
cat ready.txt missing.txt >> output.log 2>> errors.log
cat ready.txt missing.txt 2>&1 | tee combined.log
```

The first two attempts keep usable data separate from diagnostics. The third sends both streams through tee; a successful tee does not prove that cat succeeded.
