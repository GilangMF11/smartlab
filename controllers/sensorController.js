// controllers/sensorController.js
const { supabase } = require('../services/supabaseClient');

// Existing function for posting sensor data
exports.postSensorData = (io) => async (req, res) => {
  const { arus1, arus2, arus3, arus4 } = req.body;

  const { data, error } = await supabase
    .from('sensor_data')
    .insert([{ arus1, arus2, arus3, arus4 }]).select();

  if (error) {
    console.error('Gagal simpan data:', error.message);
    return res.status(500).json({ error: error.message });
  }

  // Emit ke dashboard
  io.emit('sensorData', { arus1, arus2, arus3, arus4 });

  res.status(201).json({ message: 'Data berhasil disimpan', data });
};

// Get power consumption data dengan berbagai periode
exports.getPowerConsumption = async (req, res) => {
    try {
        const { period } = req.params;
        const { channel } = req.query; // Optional filter by channel
        
        // Get date range for the period
        const dateString = getDateString(period);
        
        // Use Supabase query builder instead of raw SQL
        const { data: sensorData, error } = await supabase
            .from('sensor_data')
            .select('arus1, arus2, arus3, arus4, waktu')
            .gte('waktu', dateString)
            .order('waktu', { ascending: true });
        
        if (error) throw error;
        
        if (!sensorData || sensorData.length === 0) {
            return res.json({
                period,
                data: [],
                summary: {
                    total_consumption_kwh: {
                        channel1: '0.0000',
                        channel2: '0.0000',
                        channel3: '0.0000',
                        channel4: '0.0000'
                    },
                    total_all_channels_kwh: '0.0000',
                    period_description: getPeriodDescription(period),
                    data_points_total: 0
                }
            });
        }
        
        // Process data manually since we can't use complex SQL
        const processedData = processDataManually(sensorData, period);
        
        // Calculate total consumption
        const totalConsumption = {
            channel1: processedData.reduce((sum, row) => sum + parseFloat(row.channels.channel1.energy_kwh), 0).toFixed(4),
            channel2: processedData.reduce((sum, row) => sum + parseFloat(row.channels.channel2.energy_kwh), 0).toFixed(4),
            channel3: processedData.reduce((sum, row) => sum + parseFloat(row.channels.channel3.energy_kwh), 0).toFixed(4),
            channel4: processedData.reduce((sum, row) => sum + parseFloat(row.channels.channel4.energy_kwh), 0).toFixed(4)
        };
        
        const totalAllChannels = Object.values(totalConsumption)
            .reduce((sum, val) => sum + parseFloat(val), 0).toFixed(4);
        
        res.json({
            period,
            data: processedData,
            summary: {
                total_consumption_kwh: totalConsumption,
                total_all_channels_kwh: totalAllChannels,
                period_description: getPeriodDescription(period),
                data_points_total: processedData.reduce((sum, row) => sum + row.data_points, 0)
            }
        });
        
    } catch (error) {
        console.error('Error fetching power consumption:', error);
        res.status(500).json({ error: error.message });
    }
};

// Get power consumption summary untuk dashboard cards
exports.getPowerSummary = async (req, res) => {
    try {
        const periods = ['1day', '3days', '1week', '1month'];
        const summaries = {};
        
        for (const period of periods) {
            const dateString = getDateString(period);
            
            const { data: sensorData, error } = await supabase
                .from('sensor_data')
                .select('arus1, arus2, arus3, arus4')
                .gte('waktu', dateString);
            
            if (error) throw error;
            
            if (sensorData && sensorData.length > 0) {
                // Calculate averages
                const totalRecords = sensorData.length;
                const totals = sensorData.reduce((acc, row) => ({
                    ch1: acc.ch1 + (parseFloat(row.arus1) || 0),
                    ch2: acc.ch2 + (parseFloat(row.arus2) || 0),
                    ch3: acc.ch3 + (parseFloat(row.arus3) || 0),
                    ch4: acc.ch4 + (parseFloat(row.arus4) || 0)
                }), { ch1: 0, ch2: 0, ch3: 0, ch4: 0 });
                
                summaries[period] = {
                    channel1: ((totals.ch1 / totalRecords) * 220 / 1000).toFixed(4),
                    channel2: ((totals.ch2 / totalRecords) * 220 / 1000).toFixed(4),
                    channel3: ((totals.ch3 / totalRecords) * 220 / 1000).toFixed(4),
                    channel4: ((totals.ch4 / totalRecords) * 220 / 1000).toFixed(4),
                    total: (((totals.ch1 + totals.ch2 + totals.ch3 + totals.ch4) / totalRecords) * 220 / 1000).toFixed(4),
                    data_points: totalRecords
                };
            } else {
                summaries[period] = {
                    channel1: '0.0000',
                    channel2: '0.0000',
                    channel3: '0.0000',
                    channel4: '0.0000',
                    total: '0.0000',
                    data_points: 0
                };
            }
        }
        
        res.json({
            summaries,
            generated_at: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error fetching power summary:', error);
        res.status(500).json({ error: error.message });
    }
};

// Get current power usage (real-time)
exports.getCurrentPower = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('sensor_data')
            .select('arus1, arus2, arus3, arus4, waktu')
            .order('waktu', { ascending: false })
            .limit(1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            const latest = data[0];
            const currentPower = {
                channel1: {
                    current_ampere: parseFloat(latest.arus1 || 0).toFixed(2),
                    power_watt: (parseFloat(latest.arus1 || 0) * 220).toFixed(2),
                    power_kwh: (parseFloat(latest.arus1 || 0) * 220 / 1000).toFixed(4)
                },
                channel2: {
                    current_ampere: parseFloat(latest.arus2 || 0).toFixed(2),
                    power_watt: (parseFloat(latest.arus2 || 0) * 220).toFixed(2),
                    power_kwh: (parseFloat(latest.arus2 || 0) * 220 / 1000).toFixed(4)
                },
                channel3: {
                    current_ampere: parseFloat(latest.arus3 || 0).toFixed(2),
                    power_watt: (parseFloat(latest.arus3 || 0) * 220).toFixed(2),
                    power_kwh: (parseFloat(latest.arus3 || 0) * 220 / 1000).toFixed(4)
                },
                channel4: {
                    current_ampere: parseFloat(latest.arus4 || 0).toFixed(2),
                    power_watt: (parseFloat(latest.arus4 || 0) * 220).toFixed(2),
                    power_kwh: (parseFloat(latest.arus4 || 0) * 220 / 1000).toFixed(4)
                },
                timestamp: latest.waktu,
                total_power_watt: (
                    (parseFloat(latest.arus1 || 0) + parseFloat(latest.arus2 || 0) + 
                     parseFloat(latest.arus3 || 0) + parseFloat(latest.arus4 || 0)) * 220
                ).toFixed(2)
            };
            
            res.json(currentPower);
        } else {
            res.json({ 
                message: 'No recent data available',
                channel1: { current_ampere: '0.00', power_watt: '0.00', power_kwh: '0.0000' },
                channel2: { current_ampere: '0.00', power_watt: '0.00', power_kwh: '0.0000' },
                channel3: { current_ampere: '0.00', power_watt: '0.00', power_kwh: '0.0000' },
                channel4: { current_ampere: '0.00', power_watt: '0.00', power_kwh: '0.0000' },
                total_power_watt: '0.00'
            });
        }
        
    } catch (error) {
        console.error('Error fetching current power:', error);
        res.status(500).json({ error: error.message });
    }
};

// Helper function untuk get date string
function getDateString(period) {
    const now = new Date();
    const date = new Date(now);
    
    switch (period) {
        case '1day':
            date.setDate(date.getDate() - 1);
            break;
        case '3days':
            date.setDate(date.getDate() - 3);
            break;
        case '1week':
            date.setDate(date.getDate() - 7);
            break;
        case '1month':
            date.setDate(date.getDate() - 30);
            break;
        default:
            date.setDate(date.getDate() - 1);
    }
    
    return date.toISOString();
}

// Helper function untuk process data manually dengan grouping yang lebih akurat
function processDataManually(sensorData, period) {
    if (!sensorData || sensorData.length === 0) {
        return [];
    }
    
    // Group data by time period
    const groupedData = {};
    
    sensorData.forEach(row => {
        const date = new Date(row.waktu);
        let groupKey;
        
        if (period === '1day' || period === '3days') {
            // Group by hour
            groupKey = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString();
        } else {
            // Group by day  
            groupKey = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
        }
        
        if (!groupedData[groupKey]) {
            groupedData[groupKey] = {
                arus1_sum: 0,
                arus2_sum: 0,
                arus3_sum: 0,
                arus4_sum: 0,
                count: 0
            };
        }
        
        groupedData[groupKey].arus1_sum += parseFloat(row.arus1 || 0);
        groupedData[groupKey].arus2_sum += parseFloat(row.arus2 || 0);
        groupedData[groupKey].arus3_sum += parseFloat(row.arus3 || 0);
        groupedData[groupKey].arus4_sum += parseFloat(row.arus4 || 0);
        groupedData[groupKey].count++;
    });
    
    // Convert grouped data to result format
    return Object.keys(groupedData)
        .sort((a, b) => new Date(a) - new Date(b))
        .map(timeKey => {
            const group = groupedData[timeKey];
            const avgArus1 = group.arus1_sum / group.count;
            const avgArus2 = group.arus2_sum / group.count;
            const avgArus3 = group.arus3_sum / group.count;
            const avgArus4 = group.arus4_sum / group.count;
            
            // Calculate power (Watt = Ampere × 220V)
            const avgPower1 = avgArus1 * 220;
            const avgPower2 = avgArus2 * 220;
            const avgPower3 = avgArus3 * 220;
            const avgPower4 = avgArus4 * 220;
            
            // Calculate energy (kWh) - simplified as average power converted to kWh
            const energyKwh1 = avgPower1 / 1000;
            const energyKwh2 = avgPower2 / 1000;
            const energyKwh3 = avgPower3 / 1000;
            const energyKwh4 = avgPower4 / 1000;
            
            return {
                time: timeKey,
                channels: {
                    channel1: {
                        avg_power: avgPower1.toFixed(2),
                        energy_wh: (avgPower1).toFixed(2),
                        energy_kwh: energyKwh1.toFixed(4)
                    },
                    channel2: {
                        avg_power: avgPower2.toFixed(2),
                        energy_wh: (avgPower2).toFixed(2),
                        energy_kwh: energyKwh2.toFixed(4)
                    },
                    channel3: {
                        avg_power: avgPower3.toFixed(2),
                        energy_wh: (avgPower3).toFixed(2),
                        energy_kwh: energyKwh3.toFixed(4)
                    },
                    channel4: {
                        avg_power: avgPower4.toFixed(2),
                        energy_wh: (avgPower4).toFixed(2),
                        energy_kwh: energyKwh4.toFixed(4)
                    }
                },
                data_points: group.count
            };
        });
}

// Helper function untuk period description
function getPeriodDescription(period) {
    const descriptions = {
        '1day': 'Last 24 hours',
        '3days': 'Last 3 days', 
        '1week': 'Last 7 days',
        '1month': 'Last 30 days'
    };
    return descriptions[period] || 'Unknown period';
}