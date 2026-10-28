#!/bin/sh
# Rebuilds ../cup-button.html, one standalone page, from the parts in this folder.
d=$(dirname "$0")
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
  cat "$d/head.html" "$d/tokens.css" "$d/page.css" "$d/scenes.css"
  echo "</style>"
  cat "$d/body.html" "$d/scenes.html" "$d/tail.html"
  echo "</body></html>"
} > "$d/../cup-button.html"
