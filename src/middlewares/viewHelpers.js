function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('zh-CN', { hour12: false });
}

function attachViewHelpers(req, res, next) {
  res.locals.formatDateTime = formatDateTime;
  next();
}

module.exports = {
  attachViewHelpers,
  formatDateTime
};
