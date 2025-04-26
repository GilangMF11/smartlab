const express = require('express');
const router = express.Router();
const { postSensorData } = require('../controllers/sensorController');

module.exports = function(io) {
  router.post('/', postSensorData(io));
  return router;
};
