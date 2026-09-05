```bash
head -n 2 exports/users.txt
cut -d'|' -f3 exports/users.txt
cut -d'|' -f1,3 exports/users.txt
```

A simple delimiter works for this explicit input contract. Quoted CSV with embedded separators needs a CSV-aware parser.
