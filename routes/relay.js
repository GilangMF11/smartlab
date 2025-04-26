const express = require('express');
const { toggleRelay, getRelayStatus } = require('../controllers/relayController');

module.exports = function(io) {
    const router = express.Router();

    // Beri akses io ke controller
    router.post('/:id/toggle', (req, res) => toggleRelay(req, res, io));
    // Ambil semua status terkini
    router.get('/status', getRelayStatus);

  return router;
};
