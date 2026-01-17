const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = 'uploads';
const imagesDir = path.join(uploadsDir, 'images');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// File filter - only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('نوع الملف غير مدعوم. يرجى رفع صور بصيغة JPG, PNG, أو WEBP فقط.'), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// =====================================================
// UPLOAD SINGLE IMAGE
// POST /api/upload/image
// =====================================================
router.post('/image', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'لم يتم رفع أي صورة',
      });
    }

    const imageUrl = `/uploads/images/${req.file.filename}`;

    res.json({
      success: true,
      message: 'تم رفع الصورة بنجاح',
      data: {
        url: imageUrl,
        filename: req.file.filename,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error('Upload Image Error:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في رفع الصورة',
    });
  }
});

// =====================================================
// UPLOAD MULTIPLE IMAGES
// POST /api/upload/images
// =====================================================
router.post('/images', verifyToken, upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'لم يتم رفع أي صور',
      });
    }

    const uploadedImages = req.files.map(file => ({
      url: `/uploads/images/${file.filename}`,
      filename: file.filename,
      size: file.size,
    }));

    res.json({
      success: true,
      message: `تم رفع ${uploadedImages.length} صورة بنجاح`,
      data: uploadedImages,
    });
  } catch (error) {
    console.error('Upload Images Error:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في رفع الصور',
    });
  }
});

// =====================================================
// DELETE IMAGE
// DELETE /api/upload/image/:filename
// =====================================================
router.delete('/image/:filename', verifyToken, async (req, res) => {
  try {
    const { filename } = req.params;
    
    // SECURITY: Prevent path traversal attacks
    // Only allow alphanumeric, dash, underscore, and dot (for extension)
    const safeFilenameRegex = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;
    if (!safeFilenameRegex.test(filename)) {
      console.warn(`⚠️ SECURITY: Path traversal attempt detected: ${filename}`);
      return res.status(400).json({
        success: false,
        message: 'اسم ملف غير صالح',
      });
    }
    
    // SECURITY: Ensure the resolved path is within uploads directory
    const filePath = path.join(imagesDir, filename);
    const resolvedPath = path.resolve(filePath);
    const resolvedImagesDir = path.resolve(imagesDir);
    
    if (!resolvedPath.startsWith(resolvedImagesDir)) {
      console.warn(`⚠️ SECURITY: Path escape attempt: ${filename}`);
      return res.status(400).json({
        success: false,
        message: 'مسار غير صالح',
      });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({
        success: true,
        message: 'تم حذف الصورة بنجاح',
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'الصورة غير موجودة',
      });
    }
  } catch (error) {
    console.error('Delete Image Error:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في حذف الصورة',
    });
  }
});

// Error handling for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'حجم الملف كبير جداً. الحد الأقصى 10 ميجابايت.',
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'عدد الملفات كبير جداً. الحد الأقصى 5 صور.',
      });
    }
  }
  
  res.status(400).json({
    success: false,
    message: error.message || 'حدث خطأ أثناء رفع الملف',
  });
});

module.exports = router;
