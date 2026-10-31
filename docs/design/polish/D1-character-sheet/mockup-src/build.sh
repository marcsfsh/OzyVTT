#!/bin/sh
d=$(dirname "$0")
{ cat "$d/p1-head.html" "$d/p2-page.css" "$d/p3-app.css" "$d/p4-calm.css" "$d/p4-layouts3.css" "$d/p4-refined.css" "$d/p4-theme.css"; echo "</style>"; cat "$d/p5-body.html"; echo "<script>"; cat "$d/p6-parts.js" "$d/p6c-parts3.js" "$d/p6d-parts4.js" "$d/p7-main.js"; echo "</script>"; } > "$d/../ledger-sheet.html"
{ printf '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'; cat "$d/../ledger-sheet.html"; printf '</body></html>'; } > "$d/../test-ledger.html"
