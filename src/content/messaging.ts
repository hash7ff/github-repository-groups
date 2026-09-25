import type { Request, Response } from "../core/messages.ts";

/** Send a request to the service worker. Never throws; extension reloads surface as an error response. */
export async function send<T>(req: Request): Promise<Response<T>> {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as Response<T> | undefined;
    if (!res) return { ok: false, error: { kind: "other", status: 0, message: "No response from the extension service worker." } };
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { kind: "other", status: 0, message: `${message} (try reloading the page)` } };
  }
}
