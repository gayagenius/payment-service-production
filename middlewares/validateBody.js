// src/middleware/validateBody.js
export default function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { stripUnknown: true, abortEarly: false });
    if (error) {
      return res.status(422).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.details.map(d => ({ message: d.message, path: d.path })),
      });
    }
    req.body = value;
    return next();
  };
}
