import assert from "node:assert/strict";
export const base = process.env.TEST_BASE_URL || "http://localhost:80";
export async function client(role) {
  let cookie = "", csrf = "";
  const api = {
    get cookie() { return cookie; },
    get csrf() { return csrf; },
    async call(path, body, method = body === undefined ? "GET" : "POST") {
      const multipart = body instanceof FormData;
      const r = await fetch(base + "/api" + path, {
        method, headers: { cookie, "x-csrf-token": csrf, ...(!multipart ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      });
      for (const c of r.headers.getSetCookie()) {
        const kv = c.split(";")[0], n = kv.split("=")[0];
        cookie = cookie.split("; ").filter((v) => !v.startsWith(n + "=")).concat(kv).join("; ");
      }
      const d = await r.json();
      if (d.csrfToken) csrf = d.csrfToken;
      return { status: r.status, data: d };
    },
  };
  await api.call("/auth/session");
  assert.equal((await api.call("/auth/demo", { role })).status, 200);
  return api;
}
