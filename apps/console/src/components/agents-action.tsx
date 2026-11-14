import { useState } from "react";
import type { AgentPost } from "./agents-labels";
import { Button } from "./ui/button";

export function AgentsAction({
  label,
  path,
  body,
  disabled,
  post,
}: {
  label: string;
  path: string;
  body: unknown;
  disabled: boolean;
  post: AgentPost;
}) {
  const [problem, setProblem] = useState("");
  return (
    <div className="agents-action">
      <Button
        variant="outline"
        disabled={disabled}
        onClick={async () => {
          setProblem("");
          try {
            await post(path, body);
          } catch (error) {
            setProblem(error instanceof Error ? error.message : "L’action n’a pas été confirmée.");
          }
        }}
      >
        {label}
      </Button>
      {problem && (
        <p className="agents-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
