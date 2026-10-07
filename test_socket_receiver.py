import requests
import socketio


BASE_URL = "http://127.0.0.1:5000"

session = requests.Session()

# Log in as testuser first so Socket.IO receives
# the same authenticated Flask session cookie.
response = session.post(
    f"{BASE_URL}/auth/login",
    json={
        "email": "testuser@example.com",
        "password": "TestPassword456!"
    }
)

print("Login status:", response.status_code)

if response.status_code != 200:
    print("Login failed:", response.text)
    raise SystemExit(1)

print("Logged in as testuser.")

sio = socketio.Client(
    http_session=session
)


@sio.event
def connect():
    print("Socket.IO connected.")
    print("Waiting for a real-time message from Tebogo...")


@sio.on("new_message")
def new_message(data):
    print("\nNEW MESSAGE RECEIVED!")
    print("From:", data["sender_username"])
    print("Content:", data["content"])
    print("Message ID:", data["id"])


@sio.event
def disconnect():
    print("Socket.IO disconnected.")


sio.connect(BASE_URL)
sio.wait()
