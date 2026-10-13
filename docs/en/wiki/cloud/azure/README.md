---
title: "Azure Cloud"
sidebar:
  label: "Azure Cloud"
  hidden: true
aiGenerated: false
---

:::caution[Release branch only]
This directory and the `terraform/` and `deploy/` trees it documents exist on the `release` branch
only. A `main` checkout omits them so a self-hoster's clone carries just the bot. Read a page
without switching branches with `git show release:docs/en/wiki/cloud/azure/<page>.md`.
:::

These pages describe how TomoriBot's production infrastructure runs on Azure: deployment targets,
log and metric ingestion, and the operational rules around them. The AWS and GCP deployment code
under `terraform/` is retained as legacy rollback and self-hosting reference. TomoriBot's managed
GCP project was retired after the Azure cutover, and a small dedicated GCP project remains only as
an outbound AI provider, not as infrastructure.

Provider-agnostic hosting on your own machines lives under [Self-Hosting](/self-hosting/) instead,
and that content stays on `main`.

## Architecture

- [`azure-production-deployment.md`](./azure-production-deployment) OIDC and Run Command deployment,
  database-role bootstrap, host lockdown, and production operating rules
- [`azure-application-logs.md`](./azure-application-logs) shipping structured error logs from an
  Azure VM into Log Analytics and Grafana
- [`azure-vertex-auth.md`](./azure-vertex-auth) keyless authentication from the Azure VM to Google
  Vertex AI

## Runbooks

These procedures require an authorized operator. Replace resource placeholders with values from
your deployment configuration; public runbooks do not record production identifiers.

- [`azure-production-inspection.md`](./azure-production-inspection) read-only production triage
  through VM Run Command, plus host memory and swap forensics
- [`azure-terraform-state-recovery.md`](./azure-terraform-state-recovery) blob-version restore and
  stale Terraform lock recovery
