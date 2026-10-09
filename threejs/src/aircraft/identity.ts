/** Public compatibility aliases. Every alias resolves to the same selected instance and lease. */
export type AircraftId = 'ev50' | 'skytrans';

export function normalizeAircraftId(value: unknown): AircraftId | null {
  if (value === 'transwing') return 'skytrans';
  return value === 'ev50' || value === 'skytrans' ? value : null;
}

export function normalizeAircraftOperation(operation: string): string {
  switch (operation) {
    case 'transwing.mechanism':
      return 'skytrans.mechanism';
    case 'transwing.motors':
      return 'skytrans.motors';
    case 'transwing.surfaces':
      return 'skytrans.surfaces';
    default:
      return operation;
  }
}
