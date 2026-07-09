# Synapse AI — AppExchange Packaging Notes

## 1. Switch to a 2GP namespaced package

```bash
sf package create --name SynapseAI --description "Visual AI Agent Builder for Salesforce" \
                  --package-type Managed --path force-app --no-namespace=false
# Then in your dev hub: register the namespace via Setup → Package Manager → Namespace Settings
```

Add the namespace to `sfdx-project.json`:

```json
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "namespace": "synpsai",
  "sourceApiVersion": "62.0"
}
```

Every metadata API name gets prefixed with `synpsai__` after packaging. **Re-check any place we hard-code object names** (`AgentDefinition__c`, `AgentExecution__c`, `AgentNode__c`) — those become `synpsai__AgentDefinition__c` in the customer's org. Apex references are auto-namespaced; LWC `@salesforce/apex/...` imports are too. Hard-coded SOQL strings on the **Node.js server side** need updating in `server/src/salesforce/client.ts`.

## 2. Things you cannot ship in a managed package

| Item | Workaround |
|---|---|
| `LeadAgentTrigger` (touches a standard SObject) | Ship as **post-install instructions**: ask admins to enable a Quick-Action / Flow that calls `AgentRunner.run(...)` |
| Hard-coded ngrok URL in `Agent_Platform` Named Credential | Customers MUST replace the endpoint after install. Document in the listing FAQ. |
| Sample agent records (`lead_qualifier`) | Use a **post-install Apex script** in the package definition |

Strip `LeadAgentTrigger` + its handler + test from the package, OR namespace the trigger to an internal SObject the package owns.

## 3. Code coverage

Run before each beta upload:

```bash
sf apex run test --target-org <packaging-org> --code-coverage --result-format human --wait 20
```

Required: ≥75% per Apex class, 75% overall. Our tests cover the controller, runner, result handler, and lead trigger handler. If you add new classes, **add matching `*Test.cls`** at the same time.

## 4. Security review checklist

- [ ] All SOQL uses `WITH USER_MODE` (we do)
- [ ] No `crud=false` overrides
- [ ] No `with sharing` violations
- [ ] Named Credential is the only way to talk to the external server (no hard-coded URLs) — ✓
- [ ] No PII / customer data leaves the org without admin consent (the engine sends `recordId`, `orgId`, `inputPayload` — admins author the inputPayload, so document this clearly)
- [ ] FLS enforcement: `Security.stripInaccessible` for any user-data writes — TODO
- [ ] CSP allowlist: if you embed external URLs in LWC (we don't), declare them
- [ ] Checkmarx scan (run `sf scanner run --target force-app` and resolve High/Critical findings)

## 5. Beta upload

```bash
sf package version create --package SynapseAI --installation-key-bypass --wait 20 --code-coverage
```

Save the version ID (`04t...`) — that's what the AppExchange listing points at.

## 6. Promote to released

After security review passes:

```bash
sf package version promote --package "SynapseAI@1.0.0-1"
```

You can only promote a version once; bumps require a new version create + promote cycle.

## 7. Customer install flow

```
https://test.salesforce.com/packaging/installPackage.apexp?p0=04t...
```

Post-install steps the customer must do:
1. Assign the `synpsai__AgentBuilderUser` permission set
2. Edit the `synpsai__Agent_Platform` Named Credential → set their own server URL
3. Set the JWT secret on the External Credential (must match their server's `JWT_SECRET`)
4. Configure their own Connected App for server-side jsforce login
5. Build their first agent in the Synapse AI app
