// Error handling utilities for MobiWave WA commercial functions

export enum ErrorCode {
  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Authorization errors
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_TENANT = 'INVALID_TENANT',
  
  // Validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  INVALID_PHONE = 'INVALID_PHONE',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  
  // Payment errors
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  PAYMENT_TIMEOUT = 'PAYMENT_TIMEOUT',
  INVALID_PAYMENT_METHOD = 'INVALID_PAYMENT_METHOD',
  PAYMENT_VERIFICATION_FAILED = 'PAYMENT_VERIFICATION_FAILED',
  
  // M-Pesa errors
  MPESA_CONFIG_MISSING = 'MPESA_CONFIG_MISSING',
  MPESA_INVALID_CREDENTIALS = 'MPESA_INVALID_CREDENTIALS',
  MPESA_NETWORK_ERROR = 'MPESA_NETWORK_ERROR',
  MPESA_API_ERROR = 'MPESA_API_ERROR',
  MPESA_TRANSACTION_FAILED = 'MPESA_TRANSACTION_FAILED',
  
  // Subscription errors
  SUBSCRIPTION_NOT_FOUND = 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_SUSPENDED = 'SUBSCRIPTION_SUSPENDED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_CANCELLED = 'SUBSCRIPTION_CANCELLED',
  INSUFFICIENT_ALLOWANCE = 'INSUFFICIENT_ALLOWANCE',
  
  // Team management errors
  TEAM_MEMBER_NOT_FOUND = 'TEAM_MEMBER_NOT_FOUND',
  TEAM_MEMBER_ALREADY_EXISTS = 'TEAM_MEMBER_ALREADY_EXISTS',
  INVALID_ROLE = 'INVALID_ROLE',
  INVITATION_EXPIRED = 'INVITATION_EXPIRED',
  INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND',
  
  // API errors
  API_RATE_LIMIT_EXCEEDED = 'API_RATE_LIMIT_EXCEEDED',
  API_ENDPOINT_NOT_FOUND = 'API_ENDPOINT_NOT_FOUND',
  API_METHOD_NOT_ALLOWED = 'API_METHOD_NOT_ALLOWED',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_CONNECTION_ERROR = 'DATABASE_CONNECTION_ERROR',
  DATABASE_TIMEOUT = 'DATABASE_TIMEOUT',
  DATA_INTEGRITY_ERROR = 'DATA_INTEGRITY_ERROR',
  
  // External service errors
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  EMAIL_SERVICE_ERROR = 'EMAIL_SERVICE_ERROR',
  WEBHOOK_VERIFICATION_FAILED = 'WEBHOOK_VERIFICATION_FAILED',
  
  // System errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
  retry_after?: number; // For rate limiting
}

export class CommercialError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, any>;
  public readonly retry_after?: number;
  public readonly timestamp: Date;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, any>,
    retry_after?: number
  ) {
    super(message);
    this.name = 'CommercialError';
    this.code = code;
    this.details = details;
    this.retry_after = retry_after;
    this.timestamp = new Date();
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CommercialError);
    }
  }

  toJSON(): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retry_after: this.retry_after,
      timestamp: this.timestamp.toISOString()
    };
  }
}

// Error factory functions for common scenarios
export function createError(
  code: ErrorCode,
  message: string,
  details?: Record<string, any>,
  retry_after?: number
): CommercialError {
  return new CommercialError(code, message, details, retry_after);
}

export function createAuthenticationError(message: string = 'Authentication failed'): CommercialError {
  return createError(ErrorCode.UNAUTHORIZED, message);
}

export function createAuthorizationError(message: string = 'Insufficient permissions'): CommercialError {
  return createError(ErrorCode.FORBIDDEN, message);
}

export function createValidationError(field: string, value: any): CommercialError {
  return createError(
    ErrorCode.INVALID_INPUT,
    `Invalid value for field '${field}': ${JSON.stringify(value)}`,
    { field, value }
  );
}

export function createMissingFieldError(field: string): CommercialError {
  return createError(
    ErrorCode.MISSING_REQUIRED_FIELD,
    `Required field '${field}' is missing`,
    { field }
  );
}

export function createPaymentError(message: string, details?: Record<string, any>): CommercialError {
  return createError(ErrorCode.PAYMENT_FAILED, message, details);
}

export function createMpesaError(message: string, details?: Record<string, any>): CommercialError {
  return createError(ErrorCode.MPESA_API_ERROR, message, details);
}

export function createSubscriptionError(message: string, details?: Record<string, any>): CommercialError {
  return createError(ErrorCode.SUBSCRIPTION_NOT_FOUND, message, details);
}

export function createRateLimitError(retry_after: number = 60): CommercialError {
  return createError(
    ErrorCode.API_RATE_LIMIT_EXCEEDED,
    'Rate limit exceeded',
    undefined,
    retry_after
  );
}

// Error handling utilities
export function isRetryableError(error: CommercialError): boolean {
  const retryableCodes = [
    ErrorCode.PAYMENT_TIMEOUT,
    ErrorCode.MPESA_NETWORK_ERROR,
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.TIMEOUT,
    ErrorCode.DATABASE_CONNECTION_ERROR,
    ErrorCode.DATABASE_TIMEOUT
  ];
  
  return retryableCodes.includes(error.code);
}

export function shouldRetry(error: CommercialError, attempt: number, maxAttempts: number = 3): boolean {
  if (attempt >= maxAttempts) return false;
  if (!isRetryableError(error)) return false;
  
  // For rate limit errors, only retry if retry_after has passed
  if (error.code === ErrorCode.API_RATE_LIMIT_EXCEEDED && error.retry_after) {
    const retryAfterMs = error.retry_after * 1000;
    const timeSinceError = Date.now() - error.timestamp.getTime();
    return timeSinceError >= retryAfterMs;
  }
  
  return true;
}

// Error response helper
export function createErrorResponse(error: CommercialError): Response {
  const status = getHttpStatusCode(error.code);
  return new Response(
    JSON.stringify(error.toJSON()),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...(error.retry_after && { 'Retry-After': error.retry_after.toString() })
      }
    }
  );
}

// Map error codes to HTTP status codes
function getHttpStatusCode(errorCode: ErrorCode): number {
  const statusMap: Record<ErrorCode, number> = {
    [ErrorCode.UNAUTHORIZED]: 401,
    [ErrorCode.INVALID_TOKEN]: 401,
    [ErrorCode.TOKEN_EXPIRED]: 401,
    [ErrorCode.FORBIDDEN]: 403,
    [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
    [ErrorCode.INVALID_TENANT]: 404,
    [ErrorCode.INVALID_INPUT]: 422,
    [ErrorCode.MISSING_REQUIRED_FIELD]: 422,
    [ErrorCode.INVALID_EMAIL]: 422,
    [ErrorCode.INVALID_PHONE]: 422,
    [ErrorCode.INVALID_AMOUNT]: 422,
    [ErrorCode.PAYMENT_FAILED]: 400,
    [ErrorCode.INSUFFICIENT_FUNDS]: 400,
    [ErrorCode.PAYMENT_TIMEOUT]: 408,
    [ErrorCode.INVALID_PAYMENT_METHOD]: 400,
    [ErrorCode.PAYMENT_VERIFICATION_FAILED]: 400,
    [ErrorCode.MPESA_CONFIG_MISSING]: 500,
    [ErrorCode.MPESA_INVALID_CREDENTIALS]: 400,
    [ErrorCode.MPESA_NETWORK_ERROR]: 503,
    [ErrorCode.MPESA_API_ERROR]: 500,
    [ErrorCode.MPESA_TRANSACTION_FAILED]: 400,
    [ErrorCode.SUBSCRIPTION_NOT_FOUND]: 404,
    [ErrorCode.SUBSCRIPTION_SUSPENDED]: 403,
    [ErrorCode.SUBSCRIPTION_EXPIRED]: 410,
    [ErrorCode.SUBSCRIPTION_CANCELLED]: 410,
    [ErrorCode.INSUFFICIENT_ALLOWANCE]: 402,
    [ErrorCode.TEAM_MEMBER_NOT_FOUND]: 404,
    [ErrorCode.TEAM_MEMBER_ALREADY_EXISTS]: 409,
    [ErrorCode.INVALID_ROLE]: 422,
    [ErrorCode.INVITATION_EXPIRED]: 410,
    [ErrorCode.INVITATION_NOT_FOUND]: 404,
    [ErrorCode.API_RATE_LIMIT_EXCEEDED]: 429,
    [ErrorCode.API_ENDPOINT_NOT_FOUND]: 404,
    [ErrorCode.API_METHOD_NOT_ALLOWED]: 405,
    [ErrorCode.DATABASE_ERROR]: 500,
    [ErrorCode.DATABASE_CONNECTION_ERROR]: 503,
    [ErrorCode.DATABASE_TIMEOUT]: 504,
    [ErrorCode.DATA_INTEGRITY_ERROR]: 500,
    [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
    [ErrorCode.EMAIL_SERVICE_ERROR]: 500,
    [ErrorCode.WEBHOOK_VERIFICATION_FAILED]: 401,
    [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
    [ErrorCode.SERVICE_UNAVAILABLE]: 503,
    [ErrorCode.TIMEOUT]: 504,
    [ErrorCode.UNKNOWN_ERROR]: 500
  };
  
  return statusMap[errorCode] || 500;
}

// Logging utility
export function logError(error: CommercialError, context?: Record<string, any>): void {
  const logEntry = {
    timestamp: error.timestamp.toISOString(),
    code: error.code,
    message: error.message,
    details: error.details,
    context,
    stack: error.stack
  };
  
  console.error('Commercial Error:', JSON.stringify(logEntry, null, 2));
  
  // In production, send to error tracking service
  if (process.env.NODE_ENV === 'production') {
    // sendToErrorTrackingService(logEntry);
  }
}

// Retry mechanism with exponential backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: CommercialError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof CommercialError ? error : createError(ErrorCode.UNKNOWN_ERROR, error.message);
      
      if (!shouldRetry(lastError, attempt, maxAttempts)) {
        throw lastError;
      }
      
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`, lastError.message);
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError!;
}