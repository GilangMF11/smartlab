const { supabase } = require('../services/supabaseClient');

exports.toggleRelay = async (req, res, io) => {
    const relayId = parseInt(req.params.id);
    // ambil status terakhir
    const { data: statusData, error: statusError } = await supabase
      .from('relays')
      .select('state')
      .eq('relay_id', relayId)
      .maybeSingle();

    if (statusError) return res.status(500).json({ error: statusError.message });

    const currentState = statusData?.state ?? false;
    const newState = !currentState;

    // emit ke socket
    io.emit('relayCommand', { relayId, state: newState });

    // update tabel utama
    await supabase
      .from('relays')
      .upsert([{ relay_id: relayId, state: newState, updated_at: new Date().toISOString() }]);

    // log ke log
    await supabase
      .from('relay_logs')
      .insert([{ relay_id: relayId, state: newState }]);

    res.status(200).json({
      message: `Relay ${relayId} ${newState ? 'ON' : 'OFF'}`,
      status: newState ? 'ON' : 'OFF'
    });
  };

  // Ambil status terkini semua relay
exports.getRelayStatus = async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('relays')
        .select('relay_id, state');

      if (error) throw error;

      res.status(200).json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
