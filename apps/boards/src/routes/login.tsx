import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../lib/auth-client";
import { currentUser } from "../server/api";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (await currentUser()) throw redirect({ to: "/" });
  },
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(undefined);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "") })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Connexion impossible");
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <main className="page">
      <h1>{mode === "signin" ? "Connexion" : "Créer un compte"}</h1>
      <p className="muted">Boards — tableaux blancs Excalidraw, privés et partageables.</p>
      <form className="stack" onSubmit={submit}>
        {mode === "signup" && (
          <label className="field">
            Nom
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
        )}
        <label className="field">
          Adresse e-mail
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="field">
          Mot de passe (12 caractères minimum)
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={pending}>
          {mode === "signin" ? "Se connecter" : "Créer le compte"}
        </button>
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Pas de compte ? En créer un" : "Déjà un compte ? Se connecter"}
        </button>
      </form>
    </main>
  );
}
