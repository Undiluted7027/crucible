#!/usr/bin/env bash
set -euo pipefail

readonly dockside_container="${CRUCIBLE_DOCKSIDE_CONTAINER:-crucible-dockside-v401}"
readonly target_network="${CRUCIBLE_DOCKSIDE_NETWORK:-crucible-invoice-v1}"

if ! docker container inspect "$dockside_container" >/dev/null 2>&1; then
  echo "Dockside container '$dockside_container' does not exist." >&2
  exit 1
fi

if ! docker network inspect "$target_network" >/dev/null 2>&1; then
  docker network create \
    --internal \
    --label dev.crucible.owner=crucible \
    "$target_network" >/dev/null
fi

if [ "$(docker network inspect "$target_network" --format '{{.Internal}}')" != "true" ]; then
  echo "Network '$target_network' exists but is not internal." >&2
  exit 1
fi

if [ "$(docker inspect "$dockside_container" --format "{{if index .NetworkSettings.Networks \"$target_network\"}}connected{{end}}")" != "connected" ]; then
  docker network connect "$target_network" "$dockside_container"
fi

dockside_ip=$(docker inspect "$dockside_container" --format "{{(index .NetworkSettings.Networks \"$target_network\").IPAddress}}")
target_interface=$(docker exec "$dockside_container" sh -c \
  "ip -o -4 addr show | awk '\$4 ~ /^${dockside_ip//./\\.}\\// {print \$2}'")

if [ -z "$target_interface" ]; then
  echo "Could not find the Dockside interface for '$target_network'." >&2
  exit 1
fi

if ! docker exec "$dockside_container" iptables -C INPUT -i "$target_interface" \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; then
  docker exec "$dockside_container" iptables -I INPUT 1 -i "$target_interface" \
    -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
fi

if ! docker exec "$dockside_container" iptables -C INPUT -i "$target_interface" -j DROP 2>/dev/null; then
  docker exec "$dockside_container" iptables -I INPUT 2 -i "$target_interface" -j DROP
fi

echo "Configured '$target_network' on $dockside_container ($target_interface)."

