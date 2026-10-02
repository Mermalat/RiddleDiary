/** Test-only buffered HTTP adapter; never included in the plugin bundle. */
export const Platform = { isDesktopApp: true };
export class Notice {}
export class PluginSettingTab {}
export class Setting {}
export class SecretComponent {}
export async function requestUrl(params: { url: string; method: string; headers: Record<string, string>; body: string }) {
  const response = await fetch(params.url, { method: params.method, headers: params.headers, body: params.body });
  const arrayBuffer = await response.arrayBuffer();
  return { status: response.status, arrayBuffer, get json(): unknown { return JSON.parse(new TextDecoder().decode(arrayBuffer)); } };
}
