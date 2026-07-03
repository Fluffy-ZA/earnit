# Earn It

Personal habit tracker and recovery companion (PWA).

- Define **Build** habits (do daily) and **Quit** habits (avoid); each has a milestone goal in days.
- Custom rewards stay **locked** until *every* active streak reaches its milestone — one slip re-locks them.
- Installable on your phone, works fully offline.
- **All data stays on your device** (localStorage). This repo only hosts the app code; no tracking, no server, no accounts.
- JSON export/import for backups (Settings tab).

## Run locally

Any static server works:

```
python -m http.server 8765 --directory .
```

then open http://localhost:8765
