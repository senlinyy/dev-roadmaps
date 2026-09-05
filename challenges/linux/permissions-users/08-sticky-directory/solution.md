```bash
stat /shared
rm /shared/bob.txt
touch /shared/alice.txt
rm /shared/alice.txt
```

Mode `1777` permits every user to create entries, while the sticky bit restricts deletion to root, the directory owner, or the target entry's owner. Alice therefore cannot delete Bob's file but can remove her own.
