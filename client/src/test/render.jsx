import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { AuthProvider } from "@/lib/auth";

// Default signed-in user for component tests.
export const alice = { id: 1, username: "alice", email: "alice@example.test", city: "Hamilton, ON", role: "user" };

/** Shows the current location so tests can assert redirects. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

/** Renders `ui` at `route` inside the router and auth context. `path` defaults to "*". */
export function renderAt(ui, { route = "/", path = "*", user = alice } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider initialUser={user}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="/login" element={<h1>Login page</h1>} />
        </Routes>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Replaces fetch with a router of { "METHOD /api/path": body | (req) => body } entries. */
export function mockApi(routes) {
  global.fetch = jest.fn(async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url}`;
    const hit = Object.entries(routes).find(([k]) => key === k || key.startsWith(`${k}?`));
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: `No mock for ${key}` }) };
    // A route can be a fixed body or a function of the request body. Set __status to fake an error reply.
    const body = typeof hit[1] === "function" ? hit[1](init.body ? JSON.parse(init.body) : undefined) : hit[1];
    const status = body?.__status ?? 200;
    return { ok: status < 400, status, json: async () => body };
  });
  return global.fetch;
}
