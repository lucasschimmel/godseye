import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { currentUser } from "../server/api";

/** Pathless layout: every route below requires a signed-in user. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  return (
    <>
      <header className="topbar">
        <Link className="brand" to="/">
          G.O.D.S.E.Y.E <span>Boards</span>
        </Link>
        <div className="row">
          <span className="muted">{user.name}</span>
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              await navigate({ to: "/login" });
            }}
          >
            Se déconnecter
          </button>
        </div>
      </header>
      <Outlet />
    </>
  );
}
