---
title: "Azure Terraform State Recovery"
sidebar:
  label: "Terraform State Recovery"
  hidden: true
aiGenerated: false
---

:::caution[Operator runbook]
These procedures require the designated operator identity and a verified Terraform backend.
Replace `<terraform-state-account>` with the account name from your backend configuration.
Confirm the subscription with `az account show` before changing state or leases.
:::

The Azure production backend stores `production.tfstate` in the `tfstate` container of
`<terraform-state-account>`. The account uses Microsoft Entra authorization only, TLS 1.2+, blob versioning,
30-day blob/container soft delete, and a `CanNotDelete` account lock. Recovery is an operator action,
not part of routine deployment.

## Safety rules

- Stop deployment workflows and confirm no `terraform plan`, `apply`, import, or state command is
  active before touching a version or lease.
- Authenticate with the designated Entra operator identity. Do not enable storage keys or anonymous
  access for recovery.
- Pull and preserve the current state before changing anything.
- Prefer `terraform force-unlock` with the exact lock ID. Break the Azure blob lease only when the
  lock is proven stale and Terraform cannot release it.
- A state recovery changes Terraform's record, not Azure resources. Always inspect a refresh-only
  plan before any later apply.

Run commands from `terraform/azure` unless stated otherwise:

```sh
terraform init
terraform state pull > production-before-recovery.tfstate
terraform show production-before-recovery.tfstate >/dev/null
```

Store that local snapshot in an access-controlled temporary location and delete it after the
incident; Terraform state can contain sensitive values.

## Restore a previous blob version

List available versions with Entra authentication:

```sh
az storage blob list \
  --account-name "<terraform-state-account>" \
  --container-name tfstate \
  --prefix production.tfstate \
  --include v \
  --auth-mode login \
  --query "[].{versionId:versionId,lastModified:properties.lastModified,size:properties.contentLength}" \
  --output table
```

Download the selected immutable version without overwriting the live blob:

```sh
az storage blob download \
  --account-name "<terraform-state-account>" \
  --container-name tfstate \
  --name production.tfstate \
  --version-id "<VERSION_ID>" \
  --file production-recovered.tfstate \
  --auth-mode login

terraform show production-recovered.tfstate
```

Compare serial/lineage and resource addresses against the preserved current snapshot. If the
selected version is correct, promote it through Terraform so the backend locking protocol is used:

```sh
terraform state push production-recovered.tfstate
terraform plan -refresh-only -input=false -var-file=terraform.ci.tfvars
```

Do not apply until the refresh-only plan is understood. If the plan proposes unexplained changes,
stop and reconcile imports/state addresses instead of forcing infrastructure to match an uncertain
snapshot.

## Recover a stale state lock

First confirm the workflow/run that owned the lock is finished and no Terraform process remains.
Use the lock ID printed by Terraform:

```sh
terraform force-unlock "<LOCK_ID>"
```

If Terraform cannot release a proven-stale lease, inspect the blob and use the Entra-authenticated
storage lease operation only as a last resort:

```sh
az storage blob lease break \
  --account-name "<terraform-state-account>" \
  --container-name tfstate \
  --blob-name production.tfstate \
  --auth-mode login
```

Immediately run `terraform state pull` and a refresh-only plan after a forced unlock or lease break.
Record the lock owner, affected workflow run, selected blob version (if any), and validation result
in the incident notes.

## Deleted blob/container recovery

The account's 30-day soft-delete window is the recovery boundary. Use the Azure storage recovery
interface with the designated operator identity to undelete the container or blob, then follow the
version procedure above. The `CanNotDelete` lock protects the account resource but does not replace
blob versioning or soft delete. If the retention window has expired, stop: reconstruction from Azure
resource inventory and explicit imports requires a separate reviewed recovery plan.
