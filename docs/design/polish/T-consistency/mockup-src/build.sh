#!/bin/sh
# Captures the approved mockups, then writes ../consistency.html.
d=$(dirname "$0")
mkdir -p "$d/caps" "$d/caps2" "$d/caps3" "$d/caps4" "$d/caps5"
node "$d/capture.js" && node "$d/capture2.js" && node "$d/capture3.js" && node "$d/capture4.js" && node "$d/capture5.js" && python3 "$d/build.py"
