const express = require('express');
const db = require('../config/database');

const router = express.Router();

// =====================================================
// GET ALL CATEGORIES
// GET /api/categories
// =====================================================
router.get('/', async (req, res) => {
  try {
    const [categories] = await db.execute(
      'SELECT * FROM categories WHERE is_active = TRUE ORDER BY sort_order ASC'
    );

    res.json({
      success: true,
      data: categories.map(c => ({
        id: c.id,
        name: c.name,
        nameAr: c.name_ar,
        icon: c.icon,
        color: c.color,
      })),
    });
  } catch (error) {
    console.error('Get Categories Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// =====================================================
// GET CATEGORY WITH AUCTIONS
// GET /api/categories/:id
// =====================================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [categories] = await db.execute(
      'SELECT * FROM categories WHERE id = ?',
      [id]
    );

    if (categories.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const category = categories[0];

    // Get auction count
    const [countResult] = await db.execute(
      'SELECT COUNT(*) as count FROM auctions WHERE category_id = ? AND status = "active"',
      [id]
    );

    res.json({
      success: true,
      data: {
        id: category.id,
        name: category.name,
        nameAr: category.name_ar,
        icon: category.icon,
        color: category.color,
        activeAuctions: countResult[0].count,
      },
    });
  } catch (error) {
    console.error('Get Category Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch category' });
  }
});

module.exports = router;
