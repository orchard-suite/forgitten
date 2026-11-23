#!/bin/bash
# Creates the Microsoft Entra app registration a hub signs people and devices
# in with, using the Azure CLI as whoever is logged in to it.
#
#   scripts/entra-app.sh https://forgitten.example.org [key-vault-name]
#
# One registration serves both doors:
#   - the browser: a login proxy (oauth2-proxy) redirects to it and needs the
#     client id, a client secret, and a cookie secret;
#   - the CLI: `forgitten fleet join` signs in with the device code flow and
#     gets a token for the Fleet.Report scope, which the hub verifies itself.
# Assignment is required, so only people assigned to the app get in either way.
# The person running this is assigned.
#
# With a Key Vault name the three proxy values are stored there as
# forgitten-oauth2-client-id, forgitten-oauth2-client-secret, and
# forgitten-oauth2-cookie-secret. Without one they are printed.
set -euo pipefail

URL=${1:?Usage: entra-app.sh <public-url> [key-vault-name]}
VAULT=${2:-}
URL=${URL%/}
NAME=forgitten
GRAPH=https://graph.microsoft.com/v1.0

tenant=$(az account show --query tenantId -o tsv)
if [ -n "$(az ad app list --display-name "$NAME" --query "[?displayName=='$NAME'].appId" -o tsv)" ]; then
    echo "An app registration named '$NAME' already exists in tenant $tenant. Delete it or reuse its ids; this script only creates." >&2
    exit 1
fi

app_id=$(az ad app create --display-name "$NAME" --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "$URL/oauth2/callback" --is-fallback-public-client true --query appId -o tsv)
object_id=$(az ad app show --id "$app_id" --query id -o tsv)
scope_id=$(uuidgen | tr '[:upper:]' '[:lower:]')

# The scope devices ask for, and version 2 tokens: those name the app by its
# client id and come from the tenant's v2.0 issuer, which is what the hub checks.
az rest --method PATCH --uri "$GRAPH/applications/$object_id" --headers 'Content-Type=application/json' --body @- >/dev/null <<JSON
{
  "identifierUris": ["api://$app_id"],
  "api": {
    "requestedAccessTokenVersion": 2,
    "oauth2PermissionScopes": [{
      "id": "$scope_id",
      "value": "Fleet.Report",
      "type": "User",
      "isEnabled": true,
      "adminConsentDisplayName": "Report a device's repositories",
      "adminConsentDescription": "Lets the forgitten CLI add a device to the fleet and send its scan reports as the signed-in user.",
      "userConsentDisplayName": "Report this device's repositories",
      "userConsentDescription": "Lets the forgitten CLI add this device to the fleet and send its scan reports as you."
    }]
  }
}
JSON

# The CLI is this same app asking for its own scope; pre-authorizing it means nobody is shown a consent screen.
az rest --method PATCH --uri "$GRAPH/applications/$object_id" --headers 'Content-Type=application/json' --body @- >/dev/null <<JSON
{ "api": { "preAuthorizedApplications": [{ "appId": "$app_id", "delegatedPermissionIds": ["$scope_id"] }] } }
JSON

sp_id=$(az ad sp create --id "$app_id" --query id -o tsv)
az ad sp update --id "$sp_id" --set appRoleAssignmentRequired=true
me=$(az ad signed-in-user show --query id -o tsv)
az rest --method POST --uri "$GRAPH/servicePrincipals/$sp_id/appRoleAssignments" --headers 'Content-Type=application/json' \
    --body "{\"principalId\":\"$me\",\"resourceId\":\"$sp_id\",\"appRoleId\":\"00000000-0000-0000-0000-000000000000\"}" >/dev/null

client_secret=$(az ad app credential reset --id "$app_id" --display-name oauth2-proxy --years 2 --query password -o tsv 2>/dev/null)
# URL-safe base64: oauth2-proxy only decodes that alphabet. With a "+" or "/" in
# it, the proxy takes the text as 44 raw bytes and refuses to start.
cookie_secret=$(openssl rand -base64 32 | tr -- '+/' '-_')

echo "Tenant id (ENTRA_TENANT_ID): $tenant"
echo "Client id (ENTRA_CLIENT_ID): $app_id"
if [ -n "$VAULT" ]; then
    az keyvault secret set --vault-name "$VAULT" --name forgitten-oauth2-client-id --value "$app_id" --query id -o tsv
    az keyvault secret set --vault-name "$VAULT" --name forgitten-oauth2-client-secret --value "$client_secret" --query id -o tsv
    az keyvault secret set --vault-name "$VAULT" --name forgitten-oauth2-cookie-secret --value "$cookie_secret" --query id -o tsv
else
    echo "OAUTH2_PROXY_CLIENT_SECRET: $client_secret"
    echo "OAUTH2_PROXY_COOKIE_SECRET: $cookie_secret"
fi
