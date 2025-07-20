from io import BytesIO
import os
import json
import random
import requests

from colorthief import ColorThief
from base64 import b64encode
from flask import Flask, Response, render_template, request

# Flask app
app = Flask(__name__)

# Spotify Credentials from Vercel environment variables
SPOTIFY_CLIENT_ID = os.environ["SPOTIFY_CLIENT_ID"]
SPOTIFY_SECRET_ID = os.environ["SPOTIFY_SECRET_ID"]
SPOTIFY_REFRESH_TOKEN = os.environ["SPOTIFY_REFRESH_TOKEN"]

# Spotify API URLs
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing"
SPOTIFY_RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=1"
SPOTIFY_TOP_TRACKS_URL = "https://api.spotify.com/v1/me/top/tracks?limit=5&time_range=short_term"
SPOTIFY_TOP_ARTISTS_URL = "https://api.spotify.com/v1/me/top/artists?limit=5&time_range=short_term"

def get_token():
    response = requests.post(
        SPOTIFY_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": SPOTIFY_REFRESH_TOKEN,
            "client_id": SPOTIFY_CLIENT_ID,
            "client_secret": SPOTIFY_SECRET_ID,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return response.json().get("access_token")

def fetch_spotify_data(url, token):
    response = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    return response.json() if response.status_code == 200 else None

def get_image_palette(image_url):
    try:
        img_data = requests.get(image_url).content
        color_thief = ColorThief(BytesIO(img_data))
        palette = color_thief.get_palette(color_count=6)
        dominant = palette[0]
        bar = palette[1] if len(palette) > 1 else dominant
        return dominant, bar
    except:
        return (18, 18, 18), (29, 185, 84)  # default fallback

def rgb_to_hex(rgb):
    return "#%02x%02x%02x" % rgb

def encode_image_to_base64(image_url):
    try:
        img_data = requests.get(image_url).content
        return b64encode(img_data).decode("utf-8")
    except:
        return ""

@app.route("/now-playing")
def now_playing():
    token = get_token()
    now_playing = fetch_spotify_data(SPOTIFY_NOW_PLAYING_URL, token)
    recently_played = fetch_spotify_data(SPOTIFY_RECENTLY_PLAYED_URL, token)
    top_tracks = fetch_spotify_data(SPOTIFY_TOP_TRACKS_URL, token)
    top_artists = fetch_spotify_data(SPOTIFY_TOP_ARTISTS_URL, token)

    track = None
    is_playing = False

    if now_playing and now_playing.get("item"):
        track = now_playing["item"]
        is_playing = now_playing.get("is_playing", False)
    elif recently_played and recently_played.get("items"):
        track = recently_played["items"][0]["track"]

    if not track:
        return Response("No track found", status=204)

    song_name = track["name"]
    artist_name = ", ".join([artist["name"] for artist in track["artists"]])
    song_uri = track["external_urls"]["spotify"]
    artist_uri = track["artists"][0]["external_urls"]["spotify"]
    image_url = track["album"]["images"][0]["url"]

    dominant_color, bar_color = get_image_palette(image_url)
    image_base64 = encode_image_to_base64(image_url)

    template = request.args.get("theme", "spotify") + ".html.j2"

    return render_template(
        template,
        songName=song_name,
        artistName=artist_name,
        songURI=song_uri,
        artistURI=artist_uri,
        image=f"data:image/jpeg;base64,{image_base64}",
        songPalette=rgb_to_hex(dominant_color),
        barPalette=rgb_to_hex(bar_color),
        barCSS="playing" if is_playing else "paused",
        contentBar="",
    ), 200, {"Content-Type": "image/svg+xml"}

if __name__ == "__main__":
    app.run(debug=True)