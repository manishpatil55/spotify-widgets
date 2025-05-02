require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Vibrant = require('node-vibrant');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const redis = require('redis');

const app = express();

// Configure Redis for production
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  legacyMode: true
});
redisClient.connect().catch(console.error);

// Enhanced CORS configuration
const allowedOrigins = [
  'http://localhost:5500',
  'https://spotify-widgets.vercel.app',
  'https://spotify-widgets-*-manishpatil55.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.match(new RegExp(o.replace('*', '.*'))))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Session management
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

// Enhanced authentication endpoints
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

app.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    // Validate state parameter
    if (state !== req.session.state) {
      return res.status(403).send('Invalid state parameter');
    }

    const { data } = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        grant_type: 'authorization_code'
      }),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // Store tokens in session
    req.session.accessToken = data.access_token;
    req.session.refreshToken = data.refresh_token;

    res.redirect(process.env.FRONTEND_URI || '/');
  } catch (error) {
    res.status(500).send(`Authentication failed: ${error.response?.data?.error_description || error.message}`);
  }
});

// Enhanced Now Playing endpoint
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
      .catch(() => ({})); // Graceful fallback

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
      await refreshAccessToken(req);
      return res.redirect(req.originalUrl);
    }
    res.status(500).json({ error: error.message });
  }
});

async function refreshAccessToken(req) {
  try {
    const { data } = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: req.session.refreshToken
      }),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    req.session.accessToken = data.access_token;
    if (data.refresh_token) {
      req.session.refreshToken = data.refresh_token;
    }
  } catch (error) {
    console.error('Token refresh failed:', error.message);
    req.session.destroy();
  }
}

function generateRandomString(length) {
  return [...crypto.randomBytes(length)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});