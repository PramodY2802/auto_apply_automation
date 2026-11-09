/**
 * RBAC definition. Seeded into roles/permissions/role_permissions; the API
 * loads the mapping from the database at boot (so admins can extend it) and
 * falls back to this default.
 */
export const PERMISSIONS = {
  'profile:manage': 'Manage own candidate profile, resumes and preferences',
  'jobs:read': 'View own job feed and matches',
  'jobs:discover': 'Run job discovery',
  'applications:manage': 'Create, approve and track own applications',
  'platforms:connect': 'Connect external job platforms',
  'ai:configure:user': 'Configure own AI provider key (plan permitting)',
  'enterprise:read': 'View enterprise overview and analytics',
  'enterprise:members:manage': 'Invite/remove members, assign roles and teams',
  'enterprise:ai:configure': 'Configure enterprise AI providers',
  'enterprise:billing:manage': 'Manage enterprise subscription',
  'admin:users:read': 'View users and enterprises (support)',
  'admin:users:manage': 'Suspend/activate users and enterprises',
  'admin:roles:manage': 'Assign platform roles',
  'admin:plans:manage': 'Manage subscription plans',
  'admin:ai:configure': 'Configure platform AI providers',
  'admin:settings:manage': 'Manage platform settings',
  'admin:billing:read': 'View revenue, AI cost and billing',
  'admin:audit:read': 'View audit logs',
  'admin:system:read': 'View system, queue and integration health',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const USER_PERMS: Permission[] = ['profile:manage', 'jobs:read', 'jobs:discover', 'applications:manage', 'platforms:connect', 'ai:configure:user'];

export const ROLE_DEFS: { key: string; name: string; scope: 'PLATFORM' | 'ENTERPRISE'; permissions: Permission[] }[] = [
  { key: 'USER', name: 'User', scope: 'PLATFORM', permissions: USER_PERMS },
  {
    key: 'PLATFORM_ADMIN',
    name: 'Platform Admin',
    scope: 'PLATFORM',
    permissions: [...USER_PERMS, 'admin:users:read', 'admin:users:manage', 'admin:system:read', 'admin:audit:read'],
  },
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    scope: 'PLATFORM',
    permissions: Object.keys(PERMISSIONS) as Permission[],
  },
  { key: 'ENTERPRISE_USER', name: 'Enterprise User', scope: 'ENTERPRISE', permissions: [] },
  {
    key: 'ENTERPRISE_ADMIN',
    name: 'Enterprise Admin',
    scope: 'ENTERPRISE',
    permissions: ['enterprise:read', 'enterprise:members:manage', 'enterprise:ai:configure', 'enterprise:billing:manage'],
  },
];

export function permissionsFor(platformRole: string, enterpriseRole: string | null, map = ROLE_DEFS): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of map) {
    if (r.key === platformRole || (enterpriseRole && r.key === enterpriseRole)) r.permissions.forEach((p) => set.add(p));
  }
  return set;
}
