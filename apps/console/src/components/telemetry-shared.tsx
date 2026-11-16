import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "@/lib/api";
import type { AgentPost } from "./agents-labels";

export function useTelemetryMutation() {
  const cache = useQueryClient();
  const intents = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: async ({
      path,
      body,
      method,
    }: {
      path: string;
      body: unknown;
      method: "POST" | "PUT";
    }) => {
      const input = JSON.stringify(body);
      const identity = `${method}:${path}:${input}`;
      if (intents.current.size >= 32 && !intents.current.has(identity))
        throw new Error("Actualisez les demandes non confirmées avant de continuer.");
      const key = intents.current.get(identity) ?? crypto.randomUUID();
      intents.current.set(identity, key);
      const result = await api<unknown>(path, {
        method,
        body: input,
        headers: { "idempotency-key": key },
      });
      intents.current.delete(identity);
      return result;
    },
    retry: false,
    onSuccess: async () => {
      await cache.invalidateQueries();
    },
  });
  const post: AgentPost = (path, body, method = "POST") =>
    mutation.mutateAsync({ path, body, method });
  return { ...mutation, post };
}

export function micros(value: number | null) {
  if (value === null) return "Inconnu";
  const amount = BigInt(value);
  const sign = amount < 0n ? "−" : "";
  const absolute = amount < 0n ? -amount : amount;
  return `${sign}${absolute / 1000000n}.${(absolute % 1000000n).toString().padStart(6, "0")} USD (${value} µUSD)`;
}

export function Field({
  name,
  label,
  type = "text",
  required = true,
  value,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  value?: string | number;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={value}
        step={type === "number" ? "1" : undefined}
        min={type === "number" ? "0" : undefined}
      />
    </label>
  );
}

export function queryString(values: Record<string, string>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  return query.toString();
}
