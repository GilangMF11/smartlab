const { supabase } = require('../services/supabaseClient');

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

