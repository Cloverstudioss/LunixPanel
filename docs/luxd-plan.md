# Luxd — LunixPanel Daemon (Planned, Low Priority)

Status: **Planned** — not in v1. LunixPanel v1 is 100% Wings compatible; Luxd will be a drop-in replacement.

Scope: Single binary daemon for LunixPanel. Same REST surface as Wings on `:8080` (`/api/system`, `/api/servers/:uuid/*`, files, power, backups, SFTP `:2022`), Docker via bollard/dockerode, cgroups, archiving. Future: gRPC control plane.

Migration: Stop wings, replace binary with `luxd`, keep same `config.yml` (panel URL + token), start luxd. No panel config change.

