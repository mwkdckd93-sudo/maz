/**
 * URL Configuration
 * All URLs are read from environment variables for easy domain changes
 */

const config = {
  // Base URL for API (used for generating full URLs for images, etc.)
  baseUrl: process.env.BASE_URL || 'https://api.hajja.app',
  
  // Get full URL for uploads
  getUploadUrl: (path) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    const base = config.baseUrl;
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  },
  
  // Get full image URL
  getImageUrl: (imagePath) => {
    return config.getUploadUrl(imagePath);
  },
  
  // Get full video URL
  getVideoUrl: (videoPath) => {
    return config.getUploadUrl(videoPath);
  },
  
  // Strip base URL to get relative path (for storage)
  toRelativePath: (fullUrl) => {
    if (!fullUrl) return null;
    if (!fullUrl.startsWith('http')) return fullUrl;
    return fullUrl.replace(config.baseUrl, '');
  }
};

module.exports = config;
