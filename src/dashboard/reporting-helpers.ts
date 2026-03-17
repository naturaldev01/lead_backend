export function isHrFormName(formName?: string | null): boolean {
  return !!formName && formName.trim().toUpperCase().startsWith('HR-');
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
