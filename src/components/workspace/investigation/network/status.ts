export function statusTextClass(status: number) {
  if (status >= 400) return "text-danger";
  if (status >= 300) return "text-muted";
  return "text-success";
}
