const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { supabase } = require('../services/supabaseClient');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !user) {
    return res.status(401).json({ success: false, message: 'User not found' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid password' });
  }

  req.session.user = {
    id: user.id,
    username: user.username
  };
  

  // Optional: create a session/token
  return res.status(200).json({ success: true, message: 'Login successful', user });

});

router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert([{ username, password_hash: hashedPassword }]);

  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }

  res.status(201).json({ success: true, message: 'User registered successfully' });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});



module.exports = router;
