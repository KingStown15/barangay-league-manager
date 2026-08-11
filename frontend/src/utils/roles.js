export function isSuperAdminRole(role) {
  return role === 'super_admin';
}

export function isAdminRole(role) {
  return role === 'admin' || isSuperAdminRole(role);
}

export function roleSatisfies(actualRole, allowedRoles = []) {
  if (allowedRoles.includes(actualRole)) return true;
  return isSuperAdminRole(actualRole) && allowedRoles.includes('admin');
}
