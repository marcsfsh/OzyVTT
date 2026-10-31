#!/bin/sh
d=$(dirname "$0")
{ cat "$d/p1-head.html" "$d/p2-page.css" "$d/p3-app.css" "$d/p4-spec.css" "$d/p4b-frame.css" "$d/p4d-chars.css" "$d/p4t-touch.css" "$d/p4v-parts.css"; echo "</style>"; cat "$d/p5-body.html"; echo "<script>"; cat "$d/audit-d.js" "$d/p6-chars.js"; echo "</script>"; } > "$d/../characters.html"
