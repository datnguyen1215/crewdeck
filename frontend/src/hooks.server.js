/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const { pathname } = event.url;

  // Register page — always allow
  if (pathname.startsWith("/register")) {
    return resolve(event);
  }

  // Setup page — requires a valid session
  if (pathname.startsWith("/setup")) {
    const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";
    try {
      const cookieHeader = event.request.headers.get("cookie") || "";
      const res = await fetch(`${backendUrl}/api/v1/auth/me`, {
        headers: { cookie: cookieHeader },
      });
      if (res.status === 401) {
        return new Response(null, {
          status: 302,
          headers: { location: "/login" },
        });
      }
    } catch {
      // Backend unreachable — allow through
    }
    return resolve(event);
  }

  // Login page — redirect to /register if no admin exists yet
  if (pathname.startsWith("/login")) {
    const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:9381";
    try {
      const setupRes = await fetch(`${backendUrl}/api/v1/auth/setup-status`);
      if (setupRes.ok) {
        const { needsSetup } = await setupRes.json();
        if (needsSetup) {
          return new Response(null, {
            status: 302,
            headers: { location: "/register" },
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
            headers: { location: "/register" },
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
