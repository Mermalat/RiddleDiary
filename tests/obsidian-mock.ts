/** Test-only buffered HTTP adapter; never included in the plugin bundle. */
export const Platform = { isDesktopApp: true };
export class Notice {}
export class PluginSettingTab {}
export class Setting {}
export async function requestUrl(params: { url: string; method: string; headers: Record<string, string>; body: string }) {
  const response = await fetch(params.url, { method: params.method, headers: params.headers, body: params.body });
  return { status: response.status, json: await response.json() as unknown };
}
