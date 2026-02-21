require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // For development, allow all origins
  }
});

app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/gitlane_chat'
});

// Initialize database table (for development convenience)
const initDb = async () => {
  const setupSql = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      repo_id VARCHAR(255) NOT NULL,
      author_name VARCHAR(255) NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_repo_id ON messages(repo_id);
  `;
  try {
    await pool.query(setupSql);
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
  }
};
initDb();

// REST Route: Get message history for a repository
app.get('/api/chat/:repoId', async (req, res) => {
  const { repoId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE repo_id = $1 ORDER BY created_at ASC LIMIT 100',
      [repoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket Server
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Client joins a specific repository's chat room
  socket.on('join_repo', (repoId) => {
    socket.join(repoId);
    console.log(`Socket ${socket.id} joined room ${repoId}`);
  });

  // Client sends a message
  socket.on('send_message', async (data) => {
    const { repoId, authorName, text } = data;
    
    // Save to DB
    try {
      const result = await pool.query(
        'INSERT INTO messages (repo_id, author_name, text) VALUES ($1, $2, $3) RETURNING *',
        [repoId, authorName, text]
      );
      const savedMessage = result.rows[0];
      
      // Broadcast to everyone in the room (including sender)
      io.to(repoId).emit('receive_message', savedMessage);
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
