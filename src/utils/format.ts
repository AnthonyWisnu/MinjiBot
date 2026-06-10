export function formatDateId(date: Date | null | undefined): string {
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatNullableText(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "-";
}
