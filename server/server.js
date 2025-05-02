require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Vibrant = require('node-vibrant');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const redis = require('redis');
const crypto = require('crypto');

const { getTokens, refreshAccessToken } = require('./auth');

const app = express();

const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  legacyMode: true
});
redisClient.connect().catch(console.error);

// CORS setup
const allowedOrigins = [
  'http://localhost:5500',
  'https://spotify-widgets.vercel.app',
  'https://spotify-widgets-.*.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.match(new RegExp(o)))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Session
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 3600000 // 1 hour
  }
}));

// /api/auth
app.get('/api/auth', (req, res) => {
  const state = generateRandomString(16);
  req.session.state = state;

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  const params = {
    client_id: process.env.SPOTIFY_CLIENT_ID,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    response_type: 'code',
    scope: 'user-read-currently-playing user-read-playback-state',
    state: state,
    show_dialog: true
  };
  authUrl.search = new URLSearchParams(params).toString();
  res.redirect(authUrl.href);
});

// /api/auth/callback
app.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (state !== req.session.state) {
      return res.status(403).send('Invalid state parameter');
    }

    const tokenData = await getTokens(code);

    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;

    res.redirect(process.env.FRONTEND_URI || '/');
  } catch (error) {
    res.status(500).send(`Authentication failed: ${error.response?.data?.error_description || error.message}`);
  }
});

// /api/now-playing
app.get('/api/now-playing', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data } = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { 'Authorization': `Bearer ${req.session.accessToken}` }
    });

    if (!data || !data.item) {
      return res.json({ is_playing: false });
    }

    const palette = await Vibrant.from(data.item.album.images[0]?.url)
      .getPalette()
      .catch(() => ({}));

    res.json({
      is_playing: data.is_playing,
      progress_ms: data.progress_ms || 0,
      item: {
        id: data.item.id,
        name: data.item.name,
        artists: data.item.artists.map(artist => artist.name),
        album: {
          name: data.item.album.name,
          image: data.item.album.images[0]?.url || ''
        },
        duration_ms: data.item.duration_ms
      },
      colors: {
        dominant: palette.Vibrant?.hex || '#1DB954',
        secondary: palette.Muted?.hex || '#191414'
      }
    });
  } catch (error) {
    if (error.response?.status === 401 && req.session.refreshToken) {
      try {
        const tokenData = await refreshAccessToken(req.session.refreshToken);
        req.session.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
          req.session.refreshToken = tokenData.refresh_token;
        }
        return res.redirect(req.originalUrl);
      } catch (refreshError) {
        req.session.destroy();
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    }
    res.status(500).json({ error: error.message });
  }
});

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});