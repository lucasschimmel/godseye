/** Trusted guest-only routing for the pinned Codex CLI. No host/vendor auth is inherited. */
export const codingCodexCatalog = {
  models: [
    {
      slug: "gpt-5.4-mini",
      display_name: "GODSEYE task broker",
      base_instructions: "Complete the requested repository edit and report observed results.",
      default_reasoning_level: "none",
      supported_reasoning_levels: [{ effort: "none", description: "Plaintext task execution" }],
      supports_reasoning_summary_parameter: false,
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: 0,
      support_verbosity: false,
      truncation_policy: { mode: "tokens", limit: 10000 },
      experimental_supported_tools: [],
    },
  ],
};

/** Fixed arrays only: no caller URL, model, retry policy, file path or extra argv. */
export function codingCodexArguments() {
  const provider =
    'model_providers.godseye={name="GODSEYE Task Broker",base_url="http://127.0.0.1:8080/v1",env_key="CODEX_API_KEY",wire_api="responses",requires_openai_auth=false,supports_websockets=false,request_max_retries=0,stream_max_retries=0,stream_idle_timeout_ms=15000}';
  return [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--ignore-user-config",
    "--ignore-rules",
    "--model",
    "gpt-5.4-mini",
    "-c",
    'model_reasoning_effort="none"',
    "-c",
    'model_provider="godseye"',
    "-c",
    provider,
    "-c",
    'model_catalog_json="/coding/codex-models.json"',
    "-c",
    'web_search="disabled"',
    "-c",
    "check_for_update_on_startup=false",
    "-c",
    'cli_auth_credentials_store="ephemeral"',
    "-C",
    "/workspace",
    "-",
  ];
}
