#!/bin/sh
# Playwright launches this in place of the browser (render.ts): the headless shell runs in its own transient
# systemd scope, off the worker's memory budget. exec keeps Playwright's --remote-debugging-pipe descriptors.
exec systemd-run --user --scope --quiet --collect -p MemoryMax=640M -p CPUQuota=50% -- "$BLOG_SCRAPER_CHROME" "$@"
