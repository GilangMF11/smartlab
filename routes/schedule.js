// routes/schedule.js
const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');

// GET - Ambil semua jadwal
router.get('/status', scheduleController.getScheduleStatus);

// POST - Set/Update jadwal untuk relay tertentu
router.post('/set', scheduleController.setSchedule);

// DELETE - Hapus jadwal untuk relay tertentu
router.delete('/:relay_id', scheduleController.deleteSchedule);

// POST - Manual trigger untuk check jadwal (untuk testing)
router.post('/check', async (req, res) => {
    try {
        await scheduleController.checkAndExecuteSchedules();
        res.status(200).json({ 
            message: 'Schedule check executed successfully',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Error in manual schedule check:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET - Ambil status monitoring sistem
router.get('/monitoring', (req, res) => {
    res.status(200).json({
        message: 'Schedule monitoring is active',
        status: 'running',
        checkInterval: '60 seconds',
        lastCheck: new Date().toISOString()
    });
});

module.exports = router;