/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const { pathname } = event.url;

  // Proxy API requests to backend
  if (pathname.startsWith("/api/")) {
    const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";
    const target = `${backendUrl}${pathname}${event.url.search}`;
    const res = await fetch(target, {
      method: event.request.method,
      headers: event.request.headers,
      body: event.request.body,
      duplex: "half",
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  // Setup page — always allow
  if (pathname.startsWith("/setup")) {
    return resolve(event);
  }

  // Login page — redirect to /setup if no admin exists yet
  if (pathname.startsWith("/login")) {
    const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";
    try {
      const setupRes = await fetch(`${backendUrl}/api/v1/auth/setup-status`);
      if (setupRes.ok) {
        const { needsSetup } = await setupRes.json();
        if (needsSetup) {
          return new Response(null, {
            status: 302,
            headers: { location: "/setup" },
          });
        }
      }
    } catch {
      // Backend unreachable — let login page render
    }
    return resolve(event);
  }

  // Static assets — skip auth
  if (pathname.startsWith("/_app/") || /\.\w+$/.test(pathname)) {
    return resolve(event);
  }

  // Check session via /api/v1/auth/me — proxy directly to backend
  const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";
  try {
    const cookieHeader = event.request.headers.get("cookie") || "";
    const res = await fetch(`${backendUrl}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
    });

    if (res.status === 401) {
      // Check if setup is needed
      const setupRes = await fetch(`${backendUrl}/api/v1/auth/setup-status`);
      if (setupRes.ok) {
        const setupData = await setupRes.json();
        if (setupData.needsSetup) {
          return new Response(null, {
            status: 302,
            headers: { location: "/setup" },
          });
        }
      }
      return new Response(null, {
        status: 302,
        headers: { location: "/login" },
      });
    }

    if (!res.ok) {
      return new Response(null, {
        status: 302,
        headers: { location: "/login" },
      });
    }
  } catch {
    // Backend unreachable — allow request through rather than showing an error page.
    // Trade-off: users may see unauthenticated content during outages, but the app
    // remains accessible for development and when the backend is temporarily down.
  }

  return resolve(event);
}
