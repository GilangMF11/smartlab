require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const session = require('express-session');

// Import routes
const authRoute = require('./routes/auth');
const sensorRoute = require('./routes/sensor')(io);
const relayRoute = require('./routes/relay')(io);
const scheduleRoute = require('./routes/schedule');

// Import middleware
const { requireLogin } = require('./middleware/authMiddleware');

// Import schedule controller
const scheduleController = require('./controllers/scheduleController');

// WhatsApp Client State Management
let whatsappClient = null;
let whatsappReady = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Session configuration
app.use(session({
  secret: 'smartlabo-anto-43212',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Middleware
app.use(express.json());

// Manual routing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '/views/login.html'));
});

app.get('/dashboard', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '/views/dashboard.html'));
});

app.get('/scan', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '/views/index.html'));
});

// API Routes
app.use('/api/sensor', sensorRoute);
app.use('/api/auth', authRoute);
app.use('/api/relay', relayRoute);
app.use('/api/schedule', scheduleRoute);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Improved WhatsApp Client with better error handling
function createWhatsAppClient() {
  console.log('🔄 Creating WhatsApp client...');
  
  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: '.wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      timeout: 60000
    }
  });

  // Client Events
  client.on('qr', async (qr) => {
    console.log('📱 QR Code received');
    try {
      const qrDataURL = await qrcode.toDataURL(qr);
      io.emit('qr', qrDataURL);
      io.emit('message', 'QR Code received, please scan');
    } catch (error) {
      console.error('❌ Error generating QR code:', error);
    }
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
    whatsappReady = true;
    reconnectAttempts = 0;
    io.emit('ready', 'WhatsApp is ready!');
    io.emit('message', 'WhatsApp is ready!');
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
    io.emit('authenticated', 'Authenticated!');
    io.emit('message', 'Authenticated!');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failure:', msg);
    whatsappReady = false;
    io.emit('auth_failure', `Authentication failure: ${msg}`);
    io.emit('message', `Authentication failure: ${msg}`);
  });

  client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp disconnected:', reason);
    whatsappReady = false;
    io.emit('disconnected', `Disconnected: ${reason}`);
    io.emit('message', `Disconnected: ${reason}`);
    
    // Attempt to reconnect
    handleReconnection();
  });

  client.on('message', (message) => {
    console.log('📨 Message received:', message.from, message.body);
  });

  return client;
}

// Reconnection handler
function handleReconnection() {
  if (reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect WhatsApp (${reconnectAttempts}/${maxReconnectAttempts})`);
    
    setTimeout(() => {
      try {
        whatsappClient = createWhatsAppClient();
        whatsappClient.initialize();
      } catch (error) {
        console.error('❌ Error during reconnection:', error);
      }
    }, 5000 * reconnectAttempts); // Exponential backoff
  } else {
    console.error('❌ Max reconnection attempts reached. Please restart the server.');
    io.emit('message', 'WhatsApp connection failed. Please restart the server.');
  }
}

// Enhanced WhatsApp message sending with error handling
const sendWhatsAppMessage = async (number, message) => {
  try {
    // Check if client is ready
    if (!whatsappClient || !whatsappReady) {
      console.log('⚠️ WhatsApp client not ready. Message queued.');
      return { 
        success: false, 
        error: 'WhatsApp client not ready',
        shouldRetry: true
      };
    }

    // Check client state
    const state = await whatsappClient.getState();
    if (state !== 'CONNECTED') {
      console.log(`⚠️ WhatsApp state: ${state}. Cannot send message.`);
      return { 
        success: false, 
        error: `WhatsApp not connected. State: ${state}`,
        shouldRetry: true
      };
    }

    const formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
    
    // Add timeout for message sending
    const messagePromise = whatsappClient.sendMessage(formattedNumber, message);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Message timeout')), 30000)
    );

    await Promise.race([messagePromise, timeoutPromise]);
    
    console.log(`✅ WhatsApp message sent to ${number}`);
    return { success: true };

  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error.message);
    
    // Handle specific errors
    if (error.message.includes('Session closed') || 
        error.message.includes('Protocol error') ||
        error.message.includes('Target closed')) {
      
      console.log('🔄 Session closed, attempting to reconnect...');
      whatsappReady = false;
      handleReconnection();
      
      return { 
        success: false, 
        error: 'Session closed, reconnecting...',
        shouldRetry: true
      };
    }
    
    return { 
      success: false, 
      error: error.message,
      shouldRetry: false
    };
  }
};

// Message queue for failed messages
const messageQueue = [];

// Process message queue
const processMessageQueue = async () => {
  if (!whatsappReady || messageQueue.length === 0) return;

  console.log(`📤 Processing ${messageQueue.length} queued messages`);
  
  while (messageQueue.length > 0 && whatsappReady) {
    const queuedMessage = messageQueue.shift();
    const result = await sendWhatsAppMessage(queuedMessage.number, queuedMessage.message);
    
    if (!result.success && result.shouldRetry) {
      // Put message back in queue if it should be retried
      messageQueue.unshift(queuedMessage);
      break;
    }
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
};

// Enhanced broadcast function with queuing
const broadcastAutomationNotification = async (message) => {
  try {
    const result = await sendWhatsAppMessage('6285602924733', message);
    
    if (!result.success && result.shouldRetry) {
      // Add to queue for retry
      messageQueue.push({
        number: '6285602924733',
        message: message,
        timestamp: new Date().toISOString(),
        type: 'automation'
      });
      console.log('📝 Message added to queue for retry');
    }
    
    // Broadcast to connected clients
    io.emit('automationNotification', {
      message: message,
      timestamp: new Date().toISOString(),
      whatsappSent: result.success,
      error: result.success ? null : result.error
    });
    
    console.log('📢 Automation notification broadcasted');
    return result.success;
    
  } catch (error) {
    console.error('❌ Error broadcasting automation notification:', error);
    return false;
  }
};

// Export untuk digunakan di controller
module.exports.sendWhatsAppMessage = sendWhatsAppMessage;
module.exports.broadcastAutomationNotification = broadcastAutomationNotification;
module.exports.io = io;

// Socket.IO Events
io.on('connection', (socket) => {
  console.log('👤 User connected');

  // Send message handler
  socket.on('sendMessage', async (data) => {
    try {
      const { number, message } = data;
      const result = await sendWhatsAppMessage(number, message);
      
      socket.emit('messageSent', {
        status: result.success ? 'success' : 'error',
        message: result.success ? 'Message sent successfully' : result.error
      });
      
    } catch (error) {
      socket.emit('messageSent', {
        status: 'error',
        message: `Failed to send message: ${error.message}`
      });
    }
  });

  // Check status handler
  socket.on('checkStatus', () => {
    if (whatsappClient && whatsappReady) {
      socket.emit('ready', 'WhatsApp is connected and ready!');
    } else {
      socket.emit('message', 'WhatsApp is not connected');
    }
  });

  // Test notification handler
  socket.on('testNotification', async () => {
    try {
      const testMessage = `🤖 TEST NOTIFIKASI SISTEM

Halo! Ini adalah pesan test dari SmartLabo Dashboard.

✅ Sistem notifikasi WhatsApp berfungsi normal
🕐 Waktu test: ${new Date().toLocaleString('id-ID')}
🔧 Status: Semua sistem operasional

Terima kasih! 🙏`;

      const result = await sendWhatsAppMessage('6285602924733', testMessage);
      
      socket.emit('messageSent', {
        status: result.success ? 'success' : 'error',
        message: result.success ? 'Test notification sent successfully' : result.error
      });
      
    } catch (error) {
      socket.emit('messageSent', {
        status: 'error',
        message: `Failed to send test notification: ${error.message}`
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('👤 User disconnected');
  });
});

// Simulasi sensor data
const simulateSensorData = () => {
  const sensorData = {
    arus1: (Math.random() * 5 + 2).toFixed(2),
    arus2: (Math.random() * 4 + 1.5).toFixed(2),
    arus3: (Math.random() * 6 + 1).toFixed(2),
    arus4: (Math.random() * 3.5 + 2.5).toFixed(2)
  };
  
  io.emit('sensorData', sensorData);
};

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  
  // Initialize WhatsApp client
  setTimeout(() => {
    try {
      whatsappClient = createWhatsAppClient();
      whatsappClient.initialize();
      console.log('📱 WhatsApp client initialization started');
    } catch (error) {
      console.error('❌ Error initializing WhatsApp client:', error);
    }
  }, 2000);
  
  // Process message queue periodically
  setInterval(processMessageQueue, 10000); // Every 10 seconds
  
  // Start schedule monitoring
  setTimeout(() => {
    try {
      scheduleController.startScheduleMonitoring();
      console.log('⏰ Schedule automation started');
    } catch (error) {
      console.error('❌ Error starting schedule automation:', error);
    }
  }, 20000); // Wait longer for WhatsApp to be ready
  
  // Start sensor simulation
  setTimeout(() => {
    setInterval(simulateSensorData, 3000);
    console.log('📊 Sensor data simulation started');
  }, 5000);
  
  console.log('✅ SmartLabo server initialized successfully');
});