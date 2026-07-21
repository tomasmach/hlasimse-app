type UserName = {
  first_name?: string | null;
  last_name?: string | null;
};

export function formatUserDisplayName(user?: UserName | null): string {
  const displayName = [user?.first_name, user?.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return displayName || "Uživatel";
}
