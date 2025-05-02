require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Vibrant = require('node-vibrant');

const app = express();
app.use(cors({
  origin: 'http://127.0.0.1:5500', // Your Live Server port
  credentials: true
}));
app.use(express.json());

let accessToken = '';
let refreshToken = '';

// Authentication endpoints
app.get('/api/auth', (req, res) => {
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  const params = {
    client_id: process.env.SPOTIFY_CLIENT_ID,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    response_type: 'code',
    scope: 'user-read-currently-playing user-read-playback-state'
  };
  
  authUrl.search = new URLSearchParams(params).toString();
  res.redirect(authUrl.href);
});

app.get('/api/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
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

    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    res.send('Authentication successful! You can close this window.');
  } catch (error) {
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

// Now Playing endpoint
app.get('/api/now-playing', async (req, res) => {
  try {
    const { data } = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!data || !data.item) {
      return res.json({ is_playing: false });
    }

    const palette = await Vibrant.from(data.item.album.images[0].url).getPalette();
    
    res.json({
      is_playing: data.is_playing,
      progress_ms: data.progress_ms || 0,
      item: {
        id: data.item.id,
        name: data.item.name,
        artists: data.item.artists.map(artist => artist.name),
        album: {
          name: data.item.album.name,
          image: data.item.album.images[0].url
        },
        duration_ms: data.item.duration_ms
      },
      colors: {
        dominant: palette.Vibrant.hex,
        secondary: palette.Muted.hex
      }
    });
  } catch (error) {
    if (error.response?.status === 401) refreshAccessToken();
    res.status(500).json({ error: error.message });
  }
});

async function refreshAccessToken() {
  try {
    const { data } = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
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
    accessToken = data.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});