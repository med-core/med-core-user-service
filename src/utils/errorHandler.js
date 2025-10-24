// utils/errorHandler.js (para TODOS los microservicios)
export class AppError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.details = details;
  }
}

export const sendError = (err, res) => {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { 
        details: err.details, 
        stack: err.stack 
      }),
    });
  }

  console.error('ERROR', err);
  return res.status(500).json({
    status: 'error',
    message: 'Algo salió mal!',
  });
};

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INVALID_TOKEN: 'INVALID_TOKEN',
  EXPIRED_CODE: 'EXPIRED_CODE',
};