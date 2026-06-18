function parseImages(images) {
  if (!images) {
    return [];
  }

  if (Array.isArray(images)) {
    return images;
  }

  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

module.exports = {
  parseImages
};
