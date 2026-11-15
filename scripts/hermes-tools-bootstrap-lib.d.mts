export const MAX_LIFETIME_SECONDS: number;
export const SERVICE_UID: number;
export const USER_MANAGER_UNIT: string;
export interface BootstrapSettings {
  platform: "win32" | "linux";
  distro: string | null;
  repair: boolean;
  lifetimeSeconds: number;
}
export function parseBootstrapOptions(options: string[], platform: string): BootstrapSettings;
export function commandSpec(
  settings: BootstrapSettings,
  step: { asRoot?: boolean; argv: string[] },
): { command: string; args: string[] };
export function bootstrapEnvironment(
  platform: string,
  source: Record<string, string | undefined>,
): Record<string, string | undefined>;
export function inspectProgram(): string;
export function holderProgram(lifetimeSeconds: number): string;
