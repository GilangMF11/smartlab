// routes/sensor.js
const express = require('express');
const router = express.Router();
const { 
  postSensorData, 
  getPowerConsumption, 
  getPowerSummary, 
  getCurrentPower 
} = require('../controllers/sensorController');

module.exports = function(io) {
  // Existing route for posting sensor data
  router.post('/', postSensorData(io));
  
  // New routes for power consumption analysis
  
  // Get power consumption data dengan berbagai periode
  router.get('/power/consumption/:period', getPowerConsumption);
  
  // Get power consumption summary untuk dashboard cards
  router.get('/power/summary', getPowerSummary);
  
  // Get current power usage (real-time)
  router.get('/power/current', getCurrentPower);
  
  return router;
};