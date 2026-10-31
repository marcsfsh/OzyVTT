#!/bin/sh
d=$(dirname "$0")
{ cat "$d/p1-head.html" "$d/p2-page.css" "$d/p3-app.css" "$d/p4-spec.css"; echo "</style>"; cat "$d/p5-body.html"; echo "<script>"; cat "$d/audit.js" "$d/p6-spec.js"; echo "</script>"; } > "$d/../theme-spec.html"
