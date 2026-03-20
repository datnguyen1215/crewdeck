async function handle({ event, resolve }) {
  if (event.url.pathname.startsWith("/api/")) {
    const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";
    const target = `${backendUrl}${pathname}${event.url.search}`;
    const res = await fetch(target, {
      method: event.request.method,
      headers: event.request.headers,
      body: event.request.body,
      duplex: "half"
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    });
  }
  return resolve(event);
}

export { handle };
//# sourceMappingURL=hooks.server-BU4OBRgw.js.map
