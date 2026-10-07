/** Safe API errors for expected intelligence gates and execution outcomes. */
export class IntelligenceActionError extends Error {
  constructor(
    readonly code: string,
    readonly status: 403 | 409 | 429 | 502,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'IntelligenceActionError';
  }
}
