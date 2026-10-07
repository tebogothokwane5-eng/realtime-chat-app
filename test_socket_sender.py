import requests
import socketio
import time


BASE_URL = "http://127.0.0.1:5000"

session = requests.Session()

response = session.post(
    f"{BASE_URL}/auth/login",
    json={
        "email": "tebogo@example.com",
        "password": "TestPassword123!"
    }
)

print("Login status:", response.status_code)

if response.status_code != 200:
    print("Login failed:", response.text)
    raise SystemExit(1)

print("Logged in as Tebogo.")

sio = socketio.Client(http_session=session)


@sio.event
def connect():
    print("Socket.IO connected.")

    sio.emit(
        "send_message",
        {
            "receiver_id": 2,
            "content": "Hello testuser! This message arrived in real time."
        }
    )


@sio.on("message_sent")
def message_sent(data):
    print("\nMESSAGE SAVED!")
    print("Message ID:", data["id"])
    print("To user:", data["receiver_id"])
    print("Content:", data["content"])

    time.sleep(1)
    sio.disconnect()


@sio.on("error")
def socket_error(data):
    print("Socket error:", data)
    sio.disconnect()


@sio.event
def disconnect():
    print("Socket.IO disconnected.")


sio.connect(BASE_URL)
sio.wait()
