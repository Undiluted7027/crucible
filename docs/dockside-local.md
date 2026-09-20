# Local Dockside setup for slice 1

The invoice target is tested against Dockside `v4.0.1` at revision `c5834215605e4230f9c1f6b576fd8f49b5a71629`. The supported setup recorded so far is Docker Desktop on an Apple silicon Mac with `linux/arm64` containers.

## Pinned components

The Dockside image must be pulled and launched by digest:

```text
newsnowlabs/dockside@sha256:876acbdf7152d51c732b41acaf9addabadfcbb6bde3d2d7e8c7b2361a8da3c12
```

Its arm64 platform manifest is:

```text
sha256:832e545125d11af181d09d53dbab18a074717cc998dc4ad58ca3918a951b1144
```

Clone the upstream repository at the pinned revision and run `cli/dockside` directly. The documented `pip install ./cli` path is broken at this revision: it installs a launcher for `dockside_cli`, but the package contains a file named `dockside`. Crucible does not patch or replace that upstream script.

Keep this installation separate from a normal Dockside setup. The local compatibility run uses:

- container name `crucible-dockside-v401`
- server data under `.crucible/dockside-data`
- dedicated IDE and host-key volumes
- isolated CLI session directories under `.crucible`
- built-in TLS for `*.local.dockside.dev`

The Dockside management container needs the Docker socket because it is the trusted environment manager. The invoice target never receives that socket.

## Target network

Run [configure-target-network.sh](../scripts/dockside/configure-target-network.sh) after starting or restarting Dockside. The script creates an internal Docker network if needed, connects Dockside to it, and installs two stateful firewall rules inside the trusted Dockside container.

The rules allow replies to connections initiated by Dockside and reject new target-initiated connections to Dockside. Docker's internal network setting blocks ordinary outbound traffic. Unrelated targets use a different internal network.

Do not proceed if the script cannot install or verify these rules. A shared bridge without the rules does not meet the containment requirement.

## Profile and account

Load [crucible-invoice-v1.json](../config/dockside/crucible-invoice-v1.json) as profile ID `crucible-invoice-v1`. The profile fixes the image, runtime, network, Unix user, IDE version, resource limits, capabilities, and owner/developer route modes.

The runtime account must be limited to:

- profile `crucible-invoice-v1`
- network `crucible-invoice-v1`
- runtime `runc`
- image `crucible/invoice-vulnerable:slice1`
- IDE `openvscode/1.109.5`
- access modes `owner` and `developer`
- create, inspect, log, start, stop, and remove operations on its own devtainers

Do not configure a GitHub token, SSH public key, or private keypair for this account. Keep the account password and CLI session outside Git.

## Build and verification

Build the prepared target before installing the profile:

```sh
docker build --provenance=false --platform linux/arm64 \
  -t crucible/invoice-vulnerable:slice1 \
  capsules/invoice/target
```

The current verified image ID is recorded in [compatibility.json](../config/dockside/compatibility.json). The same values are pinned in `src/dockside/reviewed-setup.ts`; a test fails if the two drift. A different ID requires a new compatibility run and evidence record.

The build disables generated provenance attestations so repeated local builds produce the same runnable image manifest when the Dockerfile and inputs are unchanged. The base image remains pinned by its multi-platform digest inside the Dockerfile.

Run the adapter lifecycle test and containment verifier with:

```sh
npm run test:integration
npm run dockside:verify
```

The verifier writes [slice-1-compatibility.json](../evidence/dockside/slice-1-compatibility.json). It checks the lifecycle, application readiness, routes, resource configuration, mounts, environment, selected network boundaries, and before/after resource inventory.

This is evidence for the curated invoice target on the recorded host. It does not establish that Docker containers safely contain arbitrary hostile workloads.
