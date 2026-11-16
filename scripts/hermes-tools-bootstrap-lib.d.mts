export const MAX_LIFETIME_SECONDS: number;
export const WSL_DEFAULT_UID: number;
export function resolveServiceUid(
  platform: string,
  environment?: Record<string, string | undefined>,
  getuid?: () => number | undefined,
): number;
export function userManagerUnit(uid: number): string;
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
export function inspectProgram(uid: number): string;
export function holderProgram(lifetimeSeconds: number, uid: number): string;
