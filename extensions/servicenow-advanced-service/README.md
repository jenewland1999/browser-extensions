# ServiceNow Advanced Application Service

Small Manifest V3 extension that redirects the ServiceNow application-service
wrapper route to the advanced `cmdb_ci_service_auto.do` view for the same
record.

It uses a static main-frame redirect before the simple page loads, rewrites
matching links as they appear, and patches ServiceNow's SPA history navigation
before the application can add a simple-view entry. Back navigation therefore
returns to the table rather than looping through the simple view. It only runs
on the exact `thespot.elanco.com` origin; it does not make network requests,
inject remote code, or send telemetry.

## Install unpacked

1. Run `pnpm --filter @browser-extensions/servicenow-advanced-service build`
   from the repository root.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `extensions/servicenow-advanced-service/dist`.
5. Open a simple application-service URL and confirm it lands on the advanced
   `cmdb_ci_service_auto.do` URL.

The extension reads the encoded `sys_id` from the current wrapper URL and
constructs the advanced URL with `sysparm_stack=no`.
