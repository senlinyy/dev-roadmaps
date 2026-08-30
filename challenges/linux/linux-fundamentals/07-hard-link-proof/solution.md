```bash
ln report.txt report-backup.txt
stat report.txt report-backup.txt
echo "reviewed" >> report-backup.txt
cat report.txt
```

- Both names report the same inode and a link count of two.
- Writing through either name changes the one shared file object.
