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

// Message queue for failed messages
const messageQueue = [];

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
    
    // Process any queued messages
    setTimeout(processMessageQueue, 2000);
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
    whatsappReady = true; // Set ready state on authentication too
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

// Enhanced WhatsApp message sending with better status checking
const sendWhatsAppMessage = async (number, message) => {
  try {
    // Check if client exists
    if (!whatsappClient) {
      console.log('⚠️ WhatsApp client not initialized. Message queued.');
      return { 
        success: false, 
        error: 'WhatsApp client not initialized',
        shouldRetry: true
      };
    }

    // Check client state more accurately
    let clientState = null;
    try {
      clientState = await whatsappClient.getState();
      console.log(`📊 WhatsApp current state: ${clientState}`);
    } catch (stateError) {
      console.log('⚠️ Cannot get WhatsApp state, client may be disconnected');
      return { 
        success: false, 
        error: 'Cannot get client state',
        shouldRetry: true
      };
    }

    // Accept both CONNECTED and OPENING states for message sending
    if (clientState !== 'CONNECTED' && clientState !== 'OPENING') {
      console.log(`⚠️ WhatsApp state: ${clientState}. Cannot send message.`);
      
      // If state is DISCONNECTED, trigger reconnection
      if (clientState === 'DISCONNECTED') {
        whatsappReady = false;
        handleReconnection();
      }
      
      return { 
        success: false, 
        error: `WhatsApp not ready. State: ${clientState}`,
        shouldRetry: true
      };
    }

    const formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
    
    console.log(`📤 Attempting to send message to ${formattedNumber}`);
    
    // Add timeout for message sending with longer timeout
    const messagePromise = whatsappClient.sendMessage(formattedNumber, message);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Message timeout after 45 seconds')), 45000)
    );

    await Promise.race([messagePromise, timeoutPromise]);
    
    console.log(`✅ WhatsApp message sent successfully to ${number}`);
    return { success: true };

  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error.message);
    
    // Handle specific errors more comprehensively
    if (error.message.includes('Session closed') || 
        error.message.includes('Protocol error') ||
        error.message.includes('Target closed') ||
        error.message.includes('Navigation timeout') ||
        error.message.includes('Page crashed')) {
      
      console.log('🔄 Session issue detected, attempting to reconnect...');
      whatsappReady = false;
      handleReconnection();
      
      return { 
        success: false, 
        error: 'Session issue, reconnecting...',
        shouldRetry: true
      };
    }
    
    // Handle network or temporary errors
    if (error.message.includes('timeout') || 
        error.message.includes('network') ||
        error.message.includes('ECONNRESET')) {
      
      return { 
        success: false, 
        error: `Network issue: ${error.message}`,
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

// Process message queue with better error handling
const processMessageQueue = async () => {
  if (messageQueue.length === 0) return;

  console.log(`📤 Processing ${messageQueue.length} queued messages`);
  
  // Check if client is actually ready before processing queue
  if (!whatsappClient) {
    console.log('⚠️ WhatsApp client not available, keeping messages in queue');
    return;
  }

  try {
    const state = await whatsappClient.getState();
    if (state !== 'CONNECTED' && state !== 'OPENING') {
      console.log(`⚠️ WhatsApp not ready (${state}), keeping messages in queue`);
      return;
    }
  } catch (error) {
    console.log('⚠️ Cannot check WhatsApp state, keeping messages in queue');
    return;
  }
  
  while (messageQueue.length > 0) {
    const queuedMessage = messageQueue.shift();
    const result = await sendWhatsAppMessage(queuedMessage.number, queuedMessage.message);
    
    if (!result.success && result.shouldRetry) {
      // Put message back in queue if it should be retried
      messageQueue.unshift(queuedMessage);
      console.log('📝 Message returned to queue for retry');
      break;
    }
    
    if (result.success) {
      console.log('✅ Queued message sent successfully');
    } else {
      console.log(`❌ Queued message failed permanently: ${result.error}`);
    }
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
};

// Periodic status check and queue processing
const performPeriodicMaintenance = async () => {
  try {
    // Check WhatsApp status
    if (whatsappClient) {
      const state = await whatsappClient.getState();
      const info = whatsappClient.info;
      
      // Update ready state based on actual status
      const isActuallyReady = (state === 'CONNECTED' || state === 'OPENING') && info;
      
      if (isActuallyReady !== whatsappReady) {
        whatsappReady = isActuallyReady;
        console.log(`📊 WhatsApp ready state updated: ${whatsappReady} (State: ${state})`);
        
        // Broadcast status update
        io.emit('whatsappStatusUpdate', {
          ready: whatsappReady,
          state: state,
          hasInfo: !!info
        });
      }
    }
    
    // Process message queue if ready
    if (whatsappReady) {
      await processMessageQueue();
    }
    
  } catch (error) {
    console.error('Error in periodic maintenance:', error);
  }
};

// Enhanced broadcast function with queuing
const broadcastAutomationNotification = async (message) => {
  try {
    const result = await sendWhatsAppMessage('6281548850059', message);
    
    if (!result.success && result.shouldRetry) {
      // Add to queue for retry
      messageQueue.push({
        number: '6281548850059',
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

// Socket.IO Events with debug handlers
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

  // Check status handler with detailed state checking
  socket.on('checkStatus', async () => {
    try {
      if (whatsappClient) {
        const state = await whatsappClient.getState();
        const info = whatsappClient.info;
        
        console.log(`📊 WhatsApp Status Check - State: ${state}, Ready: ${whatsappReady}, Info: ${!!info}`);
        
        if (state === 'CONNECTED' && info) {
          socket.emit('ready', 'WhatsApp is connected and ready!');
          whatsappReady = true; // Update ready state
        } else if (state === 'OPENING') {
          socket.emit('message', 'WhatsApp is connecting...');
        } else {
          socket.emit('message', `WhatsApp status: ${state}`);
        }
      } else {
        socket.emit('message', 'WhatsApp client not initialized');
      }
    } catch (error) {
      console.error('Error checking WhatsApp status:', error);
      socket.emit('message', 'Error checking WhatsApp status');
    }
  });

  // Debug handlers
  socket.on('debugWhatsApp', async () => {
    console.log('\n🔍 === WHATSAPP DEBUG STATUS (Remote) ===');
    
    let debugInfo = {};
    try {
      debugInfo.clientExists = !!whatsappClient;
      debugInfo.readyState = whatsappReady;
      debugInfo.queueLength = messageQueue.length;
      debugInfo.reconnectAttempts = reconnectAttempts;
      
      if (whatsappClient) {
        try {
          debugInfo.state = await whatsappClient.getState();
        } catch (e) {
          debugInfo.stateError = e.message;
        }
        
        debugInfo.hasInfo = !!whatsappClient.info;
        if (whatsappClient.info) {
          debugInfo.phoneNumber = whatsappClient.info.wid.user;
          debugInfo.platform = whatsappClient.info.platform;
        }
      }
      
      console.log('Debug Info:', debugInfo);
      socket.emit('debugComplete', debugInfo);
      
    } catch (error) {
      console.error('Debug error:', error);
      socket.emit('debugComplete', { error: error.message });
    }
  });

  socket.on('forceRefreshWhatsApp', async () => {
    try {
      await performPeriodicMaintenance();
      socket.emit('refreshComplete', { success: true, message: 'Status refreshed' });
    } catch (error) {
      socket.emit('refreshComplete', { success: false, message: error.message });
    }
  });

  socket.on('restartWhatsAppClient', async () => {
    try {
      console.log('🔄 Remote restart request received');
      
      // Cleanup existing client
      if (whatsappClient) {
        try {
          await whatsappClient.destroy();
        } catch (error) {
          console.log('⚠️ Error destroying old client:', error.message);
        }
      }
      
      // Reset states
      whatsappClient = null;
      whatsappReady = false;
      reconnectAttempts = 0;
      
      // Create new client after delay
      setTimeout(() => {
        whatsappClient = createWhatsAppClient();
        whatsappClient.initialize();
        console.log('🔄 New WhatsApp client initialized via remote restart');
      }, 3000);
      
      socket.emit('restartComplete', { success: true, message: 'Client restart initiated' });
      
    } catch (error) {
      socket.emit('restartComplete', { success: false, message: error.message });
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

      const result = await sendWhatsAppMessage('6281548850059', testMessage);
      
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
  
  // Process message queue periodically with better timing
  setInterval(performPeriodicMaintenance, 15000); // Every 15 seconds
  
  // Start schedule monitoring
  setTimeout(() => {
    try {
      scheduleController.startScheduleMonitoring();
      console.log('⏰ Schedule automation started');
    } catch (error) {
      console.error('❌ Error starting schedule automation:', error);
    }
  }, 25000); // Wait longer for WhatsApp to be fully ready
  
  // Start sensor simulation
  // setTimeout(() => {
  //   setInterval(simulateSensorData, 3000);
  //   console.log('📊 Sensor data simulation started');
  // }, 5000);
  
  console.log('✅ SmartLabo server initialized successfully');
});