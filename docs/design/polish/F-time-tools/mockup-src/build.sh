#!/bin/sh
d=$(dirname "$0")
{ cat "$d/p1-head.html" "$d/p2-page.css" "$d/p2b-mobile.css" "$d/p3-app.css" "$d/p4-spec.css" "$d/p4b-frame.css" "$d/p4f-prep.css" "$d/p4g-codex.css" "$d/p4h-f2.css" "$d/p4k-f3.css" "$d/p4l-atlas.css" "$d/p4n-ft.css" "$d/p4j-set.css" "$d/p4t-touch.css" "$d/p4v-parts.css"; echo "</style>"; cat "$d/p5-body.html"; echo "<script>"; cat "$d/audit-f.js" "$d/p6-head.js" "$d/p6-body.js" "$d/p6-body2.js" "$d/p6-body3.js" "$d/p6-body4.js" "$d/p6-body5.js" "$d/p6-body6.js" "$d/p6-body7.js" "$d/p6-dec6.js" "$d/p6-tail.js"; echo "</script>"; } > "$d/../time-and-tools.html"
