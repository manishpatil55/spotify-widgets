from io import BytesIO
import os
import base64
import requests
from flask import Flask, request, Response, render_template
from colorthief import ColorThief

app = Flask(__name__)

# Placeholder Base64 image (tiny black square as fallback)
PLACEHOLDER_IMAGE = (
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0"
    "RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeBDhcAAAICSURBVFiF7ZXLTcMwEIbfF4A7QEuQDqQDugA6kA7gA7oAOpAOpAOyC"
    "xyN3bJJ3llm0cWxlYi+1zdpJQgiAIgiAIghH+DlSzx0klIkoT1t+4XgjEoNvDtrh2CJpTJPppU6mfvS6HLRJUy0Esr6nkMmUgGZWm"
    "fXJhQUFLnU3Kz7oBFnE3rk8sPPlqH6D4Smxpy0lD63Qm33YNlKllGFOx4fZZmfh23rQYbNJ9LY2NE2AwNH5mxCbeAGPfUKMuKD3n9"
    "NQTuOTQqFdrsCqOj4OclIskm0KU9R+cyX6xv5beu5JZEXdxREh9sYvYcP8lPR1KldYrJJMI8oBiW7whUCRJ0DQdKv9cHtBTz0mUQj"
    "zpvxzMTk0vW8AAAAASUVORK5CYII="
)

# Spotify API credentials (assumed already set in Vercel env vars)
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_SECRET_ID = os.environ.get("SPOTIFY_SECRET_ID")
SPOTIFY_REFRESH_TOKEN = os.environ.get("SPOTIFY_REFRESH_TOKEN")

def get_access_token():
    auth_string = f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_SECRET_ID}"
    b64_auth = base64.b64encode(auth_string.encode()).decode()
    
    response = requests.post(
        "https://accounts.spotify.com/api/token",
        data={"grant_type": "refresh_token", "refresh_token": SPOTIFY_REFRESH_TOKEN},
        headers={"Authorization": f"Basic {b64_auth}"},
    )
    return response.json().get("access_token")

def get_current_track(token):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get("https://api.spotify.com/v1/me/player/currently-playing", headers=headers)
    
    if response.status_code == 204:
        return None  # Nothing playing
    
    return response.json() if response.ok else None

def get_recent_track(token):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get("https://api.spotify.com/v1/me/player/recently-played?limit=1", headers=headers)
    return response.json().get("items", [])[0] if response.ok else None

def get_image_base64(url):
    try:
        response = requests.get(url)
        if response.status_code == 200:
            return base64.b64encode(response.content).decode("utf-8")
    except Exception:
        pass
    return PLACEHOLDER_IMAGE

def get_dominant_color(image_url):
    try:
        image_response = requests.get(image_url)
        if image_response.status_code == 200:
            color_thief = ColorThief(BytesIO(image_response.content))
            dominant_color = color_thief.get_color(quality=1)
            return f"rgb({dominant_color[0]}, {dominant_color[1]}, {dominant_color[2]})"
    except:
        pass
    return "rgb(18,18,18)"  # Spotify dark default

@app.route("/spotify.svg")
def spotify_svg():
    theme = request.args.get("theme", "light")
    token = get_access_token()
    track_data = get_current_track(token)
    
    if track_data and track_data.get("item"):
        track = track_data["item"]
        is_playing = track_data.get("is_playing", False)
    else:
        recent = get_recent_track(token)
        if not recent:
            return Response("No data", status=404)
        track = recent["track"]
        is_playing = False

    name = track.get("name", "Unknown")
    artists = ", ".join(artist["name"] for artist in track.get("artists", []))
    url = track.get("external_urls", {}).get("spotify", "#")
    album_image = track.get("album", {}).get("images", [{}])[0].get("url", "")
    image = get_image_base64(album_image)
    bg_color = get_dominant_color(album_image)

    template_name = "spotify-dark.html.j2" if theme == "dark" else "spotify.html.j2"
    svg = render_template(template_name, is_playing=is_playing, name=name, artist=artists, url=url, image=image, bg_color=bg_color)
    return Response(svg, mimetype="image/svg+xml")

@app.route("/")
def home():
    return "Spotify widget is running!"