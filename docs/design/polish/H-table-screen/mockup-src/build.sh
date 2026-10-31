#!/bin/sh
d=$(dirname "$0")
{ cat "$d/p1-head.html" "$d/p2-page.css" "$d/p2b-mobile.css" "$d/p3-app.css" "$d/p4-spec.css" "$d/p4b-frame.css" "$d/p4f-prep.css" "$d/p4g-codex.css" "$d/p4h-comp.css" "$d/p4i-tv.css" "$d/p4t-touch.css" "$d/p4v-parts.css"; echo "</style>"; cat "$d/p5-body.html"; echo "<script>"; cat "$d/audit-h.js" "$d/p6-head.js" "$d/p6-body.js" "$d/p6-dec.js" "$d/p6-tail.js"; echo "</script>"; } > "$d/../table-screen.html"
