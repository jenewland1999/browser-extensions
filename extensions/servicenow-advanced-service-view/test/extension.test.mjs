import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const applicationServiceRules = JSON.parse(
  await readFile("dist/rules/application-service.json", "utf8"),
);
const [applicationServiceRule, rawApplicationServiceRule] = applicationServiceRules;
const historySource = await readFile("dist/history.js", "utf8");
const redirectSource = await readFile("dist/redirect.js", "utf8");
const redirectContext = { URL, URLSearchParams };
runInNewContext(
  `${redirectSource}\nthis.getAdvancedApplicationServiceUrl = getAdvancedApplicationServiceUrl;`,
  redirectContext,
);
const { getAdvancedApplicationServiceUrl } = redirectContext;

const basicUrl =
  "https://thespot.elanco.com/now/nav/ui/classic/params/target/%24csdm_app_service.do%3Fsys_id%3Db6d1edd94795e91051e479e8536d43b8%26sysparm_view%3Dcsdm_view%26sysparm_record_target%3Dcmdb_ci_service_auto%26sysparm_record_row%3D1%26sysparm_record_rows%3D1%26sysparm_record_list%3Dsys_class_name%2521%253Dcmdb_ci_alert_group%255Eu_application_shortnameSTARTSWITHCMPR%255EORDERBYu_application_shortname%26sysparm_view%3Dcsdm_view";
const advancedUrl =
  "https://thespot.elanco.com/now/nav/ui/classic/params/target/cmdb_ci_service_auto.do%3Fsys_id%3Db6d1edd94795e91051e479e8536d43b8%26sysparm_stack%3Dno";

test("build emits the manifest and classic content scripts", async () => {
  const outputFiles = await readdir("dist", { recursive: true });
  const contentScript = await readFile("dist/content.js", "utf8");

  assert.ok(outputFiles.includes("manifest.json"));
  assert.ok(outputFiles.includes("history.js"));
  assert.ok(outputFiles.includes("redirect.js"));
  assert.ok(outputFiles.includes("content.js"));
  assert.ok(outputFiles.includes("rules/application-service.json"));
  assert.ok(outputFiles.includes("icons/icon.svg"));
  assert.ok(outputFiles.includes("icons/icon-16.png"));
  assert.ok(outputFiles.includes("icons/icon-32.png"));
  assert.ok(outputFiles.includes("icons/icon-48.png"));
  assert.ok(outputFiles.includes("icons/icon-128.png"));
  assert.ok(outputFiles.every((path) => !path.endsWith(".ts")));
  assert.doesNotMatch(contentScript, /\b(?:export|import)\b/);
  assert.match(contentScript, /MutationObserver/);
  assert.match(contentScript, /new WeakSet\(\)/);
  assert.match(contentScript, /stopImmediatePropagation/);
  assert.match(contentScript, /preserveApplicationServiceTableHistory/);
  assert.match(contentScript, /topWindow\.history\.pushState/);
  assert.match(contentScript, /topWindow\.location\.replace\(destination\)/);
  assert.doesNotMatch(contentScript, /window\.location\.replace/);
  assert.doesNotMatch(historySource, /\b(?:export|import)\b/);
  assert.match(historySource, /getAdvancedApplicationServiceUrl/);
  assert.match(historySource, /pushState/);
  assert.match(historySource, /replaceState/);
  assert.match(historySource, /popstate/);
});

test("uses only the exact ServiceNow host and route", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "ServiceNow Advanced Service View");
  assert.deepEqual(manifest.icons, {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  });
  assert.deepEqual(manifest.host_permissions, ["https://thespot.elanco.com/*"]);
  assert.deepEqual(manifest.permissions, ["declarativeNetRequestWithHostAccess"]);
  assert.deepEqual(manifest.declarative_net_request.rule_resources, [
    {
      id: "application-service",
      enabled: true,
      path: "rules/application-service.json",
    },
  ]);
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["https://thespot.elanco.com/*"],
      js: ["redirect.js", "history.js"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: ["https://thespot.elanco.com/*"],
      js: ["redirect.js", "content.js"],
      run_at: "document_start",
      all_frames: true,
    },
  ]);
});

test("redirects the supplied simple application-service URL", () => {
  assert.equal(getAdvancedApplicationServiceUrl(basicUrl), advancedUrl);
});

test("redirects the root-relative application-service link used by the table", () => {
  const linkUrl =
    "https://thespot.elanco.com/$csdm_app_service.do?sys_id=aa84dac01b56dc104b9e433fbd4bcb3c&sysparm_view=csdm_view&sysparm_record_target=cmdb_ci_service_auto";
  const expectedUrl =
    "https://thespot.elanco.com/now/nav/ui/classic/params/target/cmdb_ci_service_auto.do%3Fsys_id%3Daa84dac01b56dc104b9e433fbd4bcb3c%26sysparm_stack%3Dno";

  assert.equal(getAdvancedApplicationServiceUrl(linkUrl), expectedUrl);
});

test("redirects matching main-frame navigations before page load", () => {
  assert.equal(applicationServiceRule.condition.resourceTypes[0], "main_frame");
  const match = new RegExp(applicationServiceRule.condition.regexFilter).exec(basicUrl);
  assert.equal(match?.[1], "b6d1edd94795e91051e479e8536d43b8");

  const destination = applicationServiceRule.action.redirect.regexSubstitution.replace(
    "\\1",
    match?.[1] ?? "",
  );
  assert.equal(destination, advancedUrl);
});

test("redirects raw application-service main-frame navigations", () => {
  assert.equal(rawApplicationServiceRule.condition.resourceTypes[0], "main_frame");
  const rawUrl =
    "https://thespot.elanco.com/$csdm_app_service.do?sys_id=aa84dac01b56dc104b9e433fbd4bcb3c&sysparm_view=csdm_view";
  const match = new RegExp(rawApplicationServiceRule.condition.regexFilter).exec(rawUrl);
  assert.equal(match?.[1], "aa84dac01b56dc104b9e433fbd4bcb3c");

  const destination = rawApplicationServiceRule.action.redirect.regexSubstitution.replace(
    "\\1",
    match?.[1] ?? "",
  );
  assert.equal(
    destination,
    "https://thespot.elanco.com/now/nav/ui/classic/params/target/cmdb_ci_service_auto.do%3Fsys_id%3Daa84dac01b56dc104b9e433fbd4bcb3c%26sysparm_stack%3Dno",
  );
});

test("redirects any valid application-service sys_id and drops old wrapper state", () => {
  const sysId = "0123456789abcdef0123456789abcdef";
  const currentUrl = `https://thespot.elanco.com/now/nav/ui/classic/params/target/%24csdm_app_service.do%3Fsysparm_view%3Dcsdm_view%26sys_id%3D${sysId}#old-state`;
  const expectedUrl = `https://thespot.elanco.com/now/nav/ui/classic/params/target/cmdb_ci_service_auto.do%3Fsys_id%3D${sysId}%26sysparm_stack%3Dno`;

  assert.equal(getAdvancedApplicationServiceUrl(currentUrl), expectedUrl);
});

test("leaves non-simple-service and unsafe URLs unchanged", () => {
  const sysId = "b6d1edd94795e91051e479e8536d43b8";
  const advanced = `https://thespot.elanco.com/now/nav/ui/classic/params/target/cmdb_ci_service_auto.do%3Fsys_id%3D${sysId}%26sysparm_stack%3Dno`;
  const otherTarget = `https://thespot.elanco.com/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${sysId}`;
  const invalidId =
    "https://thespot.elanco.com/now/nav/ui/classic/params/target/%24csdm_app_service.do%3Fsys_id%3Dnot-a-sys-id";

  for (const url of [
    advanced,
    otherTarget,
    invalidId,
    basicUrl.replace("https://thespot.elanco.com", "https://evil.example"),
    basicUrl.replace("%24csdm_app_service", "%24csdm_app_service%25"),
    "not a URL",
  ]) {
    assert.equal(getAdvancedApplicationServiceUrl(url), null, url);
  }
});
