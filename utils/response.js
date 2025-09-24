export const successResponse = (message, data = null) => ({
  status: 'success',
  message,
  data,
});

export const errorResponse = (message, code = 'ERROR', data = null) => ({
  status: 'error',
  code,
  message,
  data,
});
