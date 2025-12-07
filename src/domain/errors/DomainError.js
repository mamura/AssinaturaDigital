export class DomainError extends Error {
   constructor(code, message, statusCode = 400, extra = {}) {
    super(message);
    this.name = code;
    this.code = code;
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

export class InvalidRequestError extends DomainError {
  constructor(message = 'Invalid request') {
    super(message, 400, 'InvalidRequestError');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super(message, 404, 'NotFoundError');
  }
}