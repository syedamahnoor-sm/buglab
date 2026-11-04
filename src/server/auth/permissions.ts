/*
 * Role-based access control: the single permission matrix. Server-only.
 * Default-deny: a permission not granted to a role here is refused, and an
 * anonymous visitor holds none of the protected ones.
 */
import "server-only";
import type { Role } from "./types";

export type Permission =
  | "account:read-own"
  | "account:update-own"
  | "admin:access"
  | "admin:challenges:read"
  | "admin:challenges:write"
  | "admin:users:read"
  | "admin:roles:assign";

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  learner: new Set<Permission>(["account:read-own", "account:update-own"]),
  admin: new Set<Permission>([
    "account:read-own",
    "account:update-own",
    "admin:access",
    "admin:challenges:read",
    "admin:challenges:write",
    "admin:users:read",
    "admin:roles:assign",
  ]),
};

export const ALL_PERMISSIONS: readonly Permission[] = [...MATRIX.admin];

/** Whether a role holds a permission. `null` is a visitor who is not signed in. */
export function can(role: Role | null, permission: Permission): boolean {
  return role !== null && Object.hasOwn(MATRIX, role) && MATRIX[role].has(permission);
}
