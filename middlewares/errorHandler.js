export default function errorHandler(err, req, res, next) {  
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  console.error('Unhandled error:', err);
  res.status(status).json({
    status: 'error',
    code,
    message: err.message || 'Internal server error',
  });
}
