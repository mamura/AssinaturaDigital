export function responseSuccess(requestId, data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestId,
      success: true,
      data,
    }),
  };
}

export function responseFailure(requestId, error) {
  const statusCode = error.statusCode || 500;

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestId,
      success: false,
      error: {
        name: error.name || "Error",
        message: error.message || "Unexpected error",
        code: error.code || error.name || "Error",
      },
    }),
  };
}
