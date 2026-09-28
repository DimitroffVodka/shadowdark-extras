#!/bin/bash
# Read-only load monitor for the Steam Deck, one line per second for $1 seconds:
# cpu = whole Deck busy % (8 threads), gpu = amdgpu busy %, memAvailMB = free memory.
# ssh -o BatchMode=yes deck@192.168.0.61 'bash -s -- 120' < deck-monitor.sh
N=${1:-60}
gpufile=$(ls /sys/class/drm/card*/device/gpu_busy_percent 2>/dev/null | head -1)
read -r _ a b c d e f g h _ < /proc/stat
pt=$((a + b + c + d + e + f + g + h)); pi=$((d + e))
for i in $(seq 1 "$N"); do
  sleep 1
  read -r _ a b c d e f g h _ < /proc/stat
  t=$((a + b + c + d + e + f + g + h)); idle=$((d + e))
  cpu=$(( 100 * ((t - pt) - (idle - pi)) / (t - pt) ))
  pt=$t; pi=$idle
  gpu=$(cat "$gpufile" 2>/dev/null)
  mem=$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)
  echo "$(date +%T) cpu=${cpu}% gpu=${gpu}% memAvailMB=${mem}"
done
