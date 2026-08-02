const SERVICE_NOW_ORIGIN = "https://thespot.elanco.com";
const NAVIGATION_TARGET_PREFIX = "/now/nav/ui/classic/params/target/";
const SIMPLE_APPLICATION_SERVICE_PATH = "/$csdm_app_service.do";
const SIMPLE_APPLICATION_SERVICE_TARGET = "$csdm_app_service.do";
const ADVANCED_APPLICATION_SERVICE_TARGET = "cmdb_ci_service_auto.do";
const SYS_ID_PATTERN = /^[a-f\d]{32}$/i;

function decodeTarget(value: string): string | null {
  let decoded = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }

    if (next === decoded) return decoded;
    decoded = next;
  }

  return decoded;
}

function getSimpleApplicationServiceQuery(url: URL): URLSearchParams | null {
  const decodedPath = decodeTarget(url.pathname);
  if (decodedPath === SIMPLE_APPLICATION_SERVICE_PATH) {
    return new URLSearchParams(url.search);
  }

  if (!url.pathname.startsWith(NAVIGATION_TARGET_PREFIX)) return null;

  const target = decodeTarget(url.pathname.slice(NAVIGATION_TARGET_PREFIX.length));
  if (target === null) return null;

  const queryStart = target.indexOf("?");
  if (queryStart === -1 || target.slice(0, queryStart) !== SIMPLE_APPLICATION_SERVICE_TARGET) {
    return null;
  }

  return new URLSearchParams(target.slice(queryStart + 1));
}

function getAdvancedApplicationServiceUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.origin !== SERVICE_NOW_ORIGIN) return null;

  const sysId = getSimpleApplicationServiceQuery(url)?.get("sys_id") ?? null;
  if (sysId === null || !SYS_ID_PATTERN.test(sysId)) return null;

  const advancedTarget = `${ADVANCED_APPLICATION_SERVICE_TARGET}?sys_id=${encodeURIComponent(sysId)}&sysparm_stack=no`;
  url.pathname = `${NAVIGATION_TARGET_PREFIX}${encodeURIComponent(advancedTarget)}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

const serviceNowRedirectRuntime = globalThis as typeof globalThis & {
  getAdvancedApplicationServiceUrl: (value: string) => string | null;
};
serviceNowRedirectRuntime.getAdvancedApplicationServiceUrl = getAdvancedApplicationServiceUrl;
