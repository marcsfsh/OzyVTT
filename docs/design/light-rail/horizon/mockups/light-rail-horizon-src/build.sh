#!/bin/sh
# Rebuilds ../light-rail-horizon.html, one standalone page, from the parts in this folder.
d=$(dirname "$0")
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>'
  cat "$d/p1-head.html" "$d/p2-base.css" "$d/p3-demos.css" "$d/p3b-player.css" "$d/p3c-more.css" "$d/p4-fx.css" "$d/p4b-horizon.css"
  echo "</style>"
  cat "$d/p5-body.html"
  echo "<script>"
  cat "$d/p6-core.js" "$d/p7-nav.js" "$d/p8-play.js" "$d/p9-rest.js" "$d/p9b-more.js" "$d/p10-player.js" "$d/p11-controls.js"
  echo "</script>"
  echo "</body></html>"
} > "$d/../light-rail-horizon.html"
