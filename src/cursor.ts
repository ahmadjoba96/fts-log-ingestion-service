export interface Cursor {
  timestamp: string;
  id: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.timestamp === 'string' &&
      typeof parsed.id === 'number'
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}
