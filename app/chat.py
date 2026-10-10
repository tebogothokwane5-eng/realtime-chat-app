import os
import uuid
from datetime import datetime, timezone
from sqlalchemy import or_, and_
from flask import Blueprint, request, jsonify, send_from_directory
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from PIL import Image, UnidentifiedImageError

from .extensions import db, socketio
from .models import User, Message, MessageReaction


chat_bp = Blueprint("chat", __name__, url_prefix="/chat")


CHAT_IMAGE_UPLOAD_FOLDER = os.path.join(
    os.path.dirname(__file__),
    "uploads",
    "chat_images"
)

ALLOWED_IMAGE_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp"
}

MAX_IMAGE_SIZE = 10 * 1024 * 1024


CHAT_AUDIO_UPLOAD_FOLDER = os.path.join(
    os.path.dirname(__file__),
    "uploads",
    "chat_audio"
)

ALLOWED_AUDIO_EXTENSIONS = {
    "webm",
    "ogg",
    "mp4",
    "m4a"
}

MAX_AUDIO_SIZE = 15 * 1024 * 1024



CHAT_VIDEO_UPLOAD_FOLDER = os.path.join(
    os.path.dirname(__file__),
    "uploads",
    "chat_videos"
)

ALLOWED_VIDEO_EXTENSIONS = {
    "mp4",
    "webm"
}

MAX_VIDEO_SIZE = 50 * 1024 * 1024


def allowed_video(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower()
        in ALLOWED_VIDEO_EXTENSIONS
    )


def allowed_audio(filename):
    return (
        "." in filename
        and
        filename.rsplit(".", 1)[1].lower()
        in ALLOWED_AUDIO_EXTENSIONS
    )


def allowed_image(filename):
    return (
        "." in filename
        and
        filename.rsplit(".", 1)[1].lower()
        in ALLOWED_IMAGE_EXTENSIONS
    )


os.makedirs(
    CHAT_IMAGE_UPLOAD_FOLDER,
    exist_ok=True
)

os.makedirs(
    CHAT_AUDIO_UPLOAD_FOLDER,
    exist_ok=True
)


def serialize_reply_for_viewer(reply_message, viewer_id):
    if reply_message is None:
        return None

    hidden_for_viewer = (
        reply_message.deleted_for_everyone_at is not None
        or (
            reply_message.sender_id == viewer_id
            and
            reply_message.deleted_for_sender_at is not None
        )
        or (
            reply_message.receiver_id == viewer_id
            and
            reply_message.deleted_for_receiver_at is not None
        )
    )

    if hidden_for_viewer:
        return {
            "id": reply_message.id,
            "sender_id": reply_message.sender_id,
            "sender_username": reply_message.sender.username,
            "content": None,
            "deleted": True
        }

    return {
        "id": reply_message.id,
        "sender_id": reply_message.sender_id,
        "sender_username": reply_message.sender.username,
        "content": reply_message.content,
        "deleted": False
    }


@chat_bp.route("/users", methods=["GET"])
@login_required
def users():
    users = (
        User.query
        .filter(User.id != current_user.id)
        .order_by(User.username.asc())
        .all()
    )

    users_data = []

    for user in users:
        last_message = (
            Message.query
            .filter(
                or_(
                    and_(
                        Message.sender_id == current_user.id,
                        Message.receiver_id == user.id,
                        Message.deleted_for_sender_at.is_(None)
                    ),
                    and_(
                        Message.sender_id == user.id,
                        Message.receiver_id == current_user.id,
                        Message.deleted_for_receiver_at.is_(None)
                    )
                ),
                Message.deleted_for_everyone_at.is_(None)
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .first()
        )

        unread_count = (
            Message.query
            .filter(
                Message.sender_id == user.id,
                Message.receiver_id == current_user.id,
                Message.read_at.is_(None),
                Message.deleted_for_receiver_at.is_(None),
                Message.deleted_for_everyone_at.is_(None)
            )
            .count()
        )

        users_data.append({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "unread_count": unread_count,
            "last_message": (
                last_message.content
                if last_message
                else None
            ),
            "last_message_at": (
                last_message.created_at.isoformat()
                if last_message
                else None
            ),
            "last_message_sender_id": (
                last_message.sender_id
                if last_message
                else None
            )
        })

    return jsonify({
        "users": users_data
    }), 200


@chat_bp.route("/send", methods=["POST"])
@login_required
def send_message():
    data = request.get_json(silent=True) or {}

    receiver_id = data.get("receiver_id")
    content = data.get("content", "").strip()
    reply_to_message_id = data.get("reply_to_message_id")

    if not receiver_id or not content:
        return jsonify({
            "error": "receiver_id and content are required."
        }), 400

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        return jsonify({
            "error": "receiver_id must be a valid integer."
        }), 400

    if receiver_id == current_user.id:
        return jsonify({
            "error": "You cannot send a message to yourself."
        }), 400

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        return jsonify({
            "error": "Receiver not found."
        }), 404

    reply_to_message = None

    if reply_to_message_id is not None:
        try:
            reply_to_message_id = int(reply_to_message_id)
        except (TypeError, ValueError):
            return jsonify({
                "error": "Invalid reply message ID."
            }), 400

        reply_to_message = db.session.get(
            Message,
            reply_to_message_id
        )

        if reply_to_message is None:
            return jsonify({
                "error": "Reply message not found."
            }), 404

        same_conversation = (
            (
                reply_to_message.sender_id == current_user.id
                and
                reply_to_message.receiver_id == receiver.id
            )
            or
            (
                reply_to_message.sender_id == receiver.id
                and
                reply_to_message.receiver_id == current_user.id
            )
        )

        if not same_conversation:
            return jsonify({
                "error": "You cannot reply to that message."
            }), 403

        if reply_to_message.deleted_for_everyone_at is not None:
            return jsonify({
                "error": "You cannot reply to a deleted message."
            }), 400

        if (
            reply_to_message.sender_id == current_user.id
            and
            reply_to_message.deleted_for_sender_at is not None
        ):
            return jsonify({
                "error": "You cannot reply to a deleted message."
            }), 400

        if (
            reply_to_message.receiver_id == current_user.id
            and
            reply_to_message.deleted_for_receiver_at is not None
        ):
            return jsonify({
                "error": "You cannot reply to a deleted message."
            }), 400

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content=content,
        reply_to_message_id=(
            reply_to_message.id
            if reply_to_message
            else None
        )
    )

    db.session.add(message)
    db.session.commit()

    return jsonify({
        "message": "Message sent successfully.",
        "data": {
            "id": message.id,
            "sender_id": message.sender_id,
            "receiver_id": message.receiver_id,
            "content": message.content,
            "message_type": message.message_type,
            "image_url": None,
            "image_original_name": None,
            "created_at": message.created_at.isoformat(),
            "read_at": None,
            "edited_at": None,
            "reactions": [],
            "reply_to": (
                {
                    "id": reply_to_message.id,
                    "sender_id": reply_to_message.sender_id,
                    "sender_username": (
                        reply_to_message.sender.username
                    ),
                    "content": reply_to_message.content
                }
                if reply_to_message
                else None
            )
        }
    }), 201


@chat_bp.route("/images/<path:filename>", methods=["GET"])
@login_required
def chat_image(filename):
    message = (
        Message.query
        .filter(
            Message.image_filename == filename,
            Message.message_type == "image",
            Message.deleted_for_everyone_at.is_(None),
            or_(
                and_(
                    Message.sender_id == current_user.id,
                    Message.deleted_for_sender_at.is_(None)
                ),
                and_(
                    Message.receiver_id == current_user.id,
                    Message.deleted_for_receiver_at.is_(None)
                )
            )
        )
        .first()
    )

    if message is None:
        return jsonify({
            "error": "Image not found."
        }), 404

    return send_from_directory(
        CHAT_IMAGE_UPLOAD_FOLDER,
        filename
    )


@chat_bp.route("/audio/<path:filename>", methods=["GET"])
@login_required
def chat_audio(filename):
    message = (
        Message.query
        .filter(
            Message.audio_filename == filename,
            Message.message_type == "audio",
            Message.deleted_for_everyone_at.is_(None),
            or_(
                and_(
                    Message.sender_id == current_user.id,
                    Message.deleted_for_sender_at.is_(None)
                ),
                and_(
                    Message.receiver_id == current_user.id,
                    Message.deleted_for_receiver_at.is_(None)
                )
            )
        )
        .first()
    )

    if message is None:
        return jsonify({
            "error": "Voice note not found."
        }), 404

    return send_from_directory(
        CHAT_AUDIO_UPLOAD_FOLDER,
        filename
    )


@chat_bp.route("/video/<path:filename>", methods=["GET"])
@login_required
def chat_video(filename):
    message = (
        Message.query
        .filter(
            Message.video_filename == filename,
            Message.message_type == "video",
            Message.deleted_for_everyone_at.is_(None),
            or_(
                and_(
                    Message.sender_id == current_user.id,
                    Message.deleted_for_sender_at.is_(None)
                ),
                and_(
                    Message.receiver_id == current_user.id,
                    Message.deleted_for_receiver_at.is_(None)
                )
            )
        )
        .first()
    )

    if message is None:
        return jsonify({
            "error": "Video not found."
        }), 404

    return send_from_directory(
        CHAT_VIDEO_UPLOAD_FOLDER,
        filename
    )


@chat_bp.route("/send-image", methods=["POST"])
@login_required
def send_image():
    receiver_id = request.form.get("receiver_id")
    image = request.files.get("image")

    if not receiver_id:
        return jsonify({
            "error": "receiver_id is required."
        }), 400

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        return jsonify({
            "error": "receiver_id must be a valid integer."
        }), 400

    if receiver_id == current_user.id:
        return jsonify({
            "error": "You cannot send an image to yourself."
        }), 400

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        return jsonify({
            "error": "Receiver not found."
        }), 404

    if image is None or not image.filename:
        return jsonify({
            "error": "An image file is required."
        }), 400

    original_name = secure_filename(image.filename)

    if not original_name or not allowed_image(original_name):
        return jsonify({
            "error": (
                "Unsupported image type. "
                "Use PNG, JPG, JPEG, GIF, or WebP."
            )
        }), 400

    image.stream.seek(0, os.SEEK_END)
    image_size = image.stream.tell()
    image.stream.seek(0)

    if image_size > MAX_IMAGE_SIZE:
        return jsonify({
            "error": "Image must be 10 MB or smaller."
        }), 400

    if image_size <= 0:
        return jsonify({
            "error": "The image file is empty."
        }), 400

    extension = original_name.rsplit(".", 1)[1].lower()

    expected_formats = {
        "png": "PNG",
        "jpg": "JPEG",
        "jpeg": "JPEG",
        "gif": "GIF",
        "webp": "WEBP"
    }

    try:
        with Image.open(image.stream) as verified_image:
            detected_format = verified_image.format
            verified_image.verify()
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError
    ):
        image.stream.seek(0)

        return jsonify({
            "error": "The uploaded file is not a valid image."
        }), 400

    image.stream.seek(0)

    if detected_format != expected_formats.get(extension):
        return jsonify({
            "error": (
                "The image contents do not match "
                "the file extension."
            )
        }), 400
    stored_filename = f"{uuid.uuid4().hex}.{extension}"

    image.save(
        os.path.join(
            CHAT_IMAGE_UPLOAD_FOLDER,
            stored_filename
        )
    )

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content="Image",
        message_type="image",
        image_filename=stored_filename,
        image_original_name=original_name
    )

    try:
        db.session.add(message)
        db.session.commit()
    except Exception:
        db.session.rollback()

        image_path = os.path.join(
            CHAT_IMAGE_UPLOAD_FOLDER,
            stored_filename
        )

        if os.path.exists(image_path):
            os.remove(image_path)

        raise

    image_url = (
        f"/chat/images/{stored_filename}"
    )

    message_data = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "message_type": message.message_type,
        "image_url": image_url,
        "image_original_name": message.image_original_name,
        "created_at": message.created_at.isoformat(),
        "read_at": None,
        "edited_at": None,
        "reply_to": None,
        "reactions": []
    }

    socketio.emit(
        "new_message",
        message_data,
        to=f"user_{receiver.id}"
    )

    socketio.emit(
        "message_sent",
        message_data,
        to=f"user_{current_user.id}"
    )

    return jsonify({
        "message": "Image sent successfully.",
        "data": message_data
    }), 201


@chat_bp.route("/send-audio", methods=["POST"])
@login_required
def send_audio():
    receiver_id = request.form.get("receiver_id")
    audio = request.files.get("audio")
    duration_ms = request.form.get("duration_ms")

    if not receiver_id:
        return jsonify({
            "error": "receiver_id is required."
        }), 400

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        return jsonify({
            "error": "receiver_id must be a valid integer."
        }), 400

    if receiver_id == current_user.id:
        return jsonify({
            "error": "You cannot send a voice note to yourself."
        }), 400

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        return jsonify({
            "error": "Receiver not found."
        }), 404

    if audio is None or not audio.filename:
        return jsonify({
            "error": "A voice-note file is required."
        }), 400

    original_name = secure_filename(audio.filename)

    if not original_name or not allowed_audio(original_name):
        return jsonify({
            "error": (
                "Unsupported voice-note format. "
                "Use WebM, OGG, MP4, or M4A."
            )
        }), 400

    audio.stream.seek(0, os.SEEK_END)
    audio_size = audio.stream.tell()
    audio.stream.seek(0)

    if audio_size > MAX_AUDIO_SIZE:
        return jsonify({
            "error": "Voice note must be 15 MB or smaller."
        }), 400

    if audio_size <= 0:
        return jsonify({
            "error": "The voice-note file is empty."
        }), 400

    try:
        duration_ms = int(duration_ms)
    except (TypeError, ValueError):
        return jsonify({
            "error": "A valid voice-note duration is required."
        }), 400

    if duration_ms <= 0:
        return jsonify({
            "error": "Voice-note duration must be greater than zero."
        }), 400

    if duration_ms > 305000:
        return jsonify({
            "error": "Voice notes cannot exceed five minutes."
        }), 400

    extension = original_name.rsplit(".", 1)[1].lower()

    header = audio.stream.read(12)
    audio.stream.seek(0)

    valid_signatures = {
        "webm": header.startswith(bytes.fromhex("1a45dfa3")),
        "ogg": header.startswith(b"OggS"),
        "mp4": header[4:8] == b"ftyp",
        "m4a": header[4:8] == b"ftyp"
    }

    if not valid_signatures.get(extension, False):
        return jsonify({
            "error": "Invalid voice-note file format."
        }), 400
    stored_filename = f"{uuid.uuid4().hex}.{extension}"

    audio_path = os.path.join(
        CHAT_AUDIO_UPLOAD_FOLDER,
        stored_filename
    )

    audio.save(audio_path)

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content="Voice note",
        message_type="audio",
        audio_filename=stored_filename,
        audio_original_name=original_name,
        audio_duration_ms=duration_ms
    )

    try:
        db.session.add(message)
        db.session.commit()
    except Exception:
        db.session.rollback()

        if os.path.exists(audio_path):
            os.remove(audio_path)

        raise

    audio_url = f"/chat/audio/{stored_filename}"

    message_data = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "message_type": message.message_type,
        "image_url": None,
        "image_original_name": None,
        "audio_url": audio_url,
        "audio_original_name": message.audio_original_name,
        "audio_duration_ms": message.audio_duration_ms,
        "created_at": message.created_at.isoformat(),
        "read_at": None,
        "edited_at": None,
        "reply_to": None,
        "reactions": []
    }

    socketio.emit(
        "new_message",
        message_data,
        to=f"user_{receiver.id}"
    )

    socketio.emit(
        "message_sent",
        message_data,
        to=f"user_{current_user.id}"
    )

    return jsonify({
        "message": "Voice note sent successfully.",
        "data": message_data
    }), 201


@chat_bp.route("/send-video", methods=["POST"])
@login_required
def send_video():
    receiver_id = request.form.get("receiver_id")
    video = request.files.get("video")

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        return jsonify({"error": "Valid receiver_id is required."}), 400

    if receiver_id == current_user.id:
        return jsonify({"error": "You cannot send a video to yourself."}), 400

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        return jsonify({"error": "Receiver not found."}), 404

    if video is None or not video.filename:
        return jsonify({"error": "A video file is required."}), 400

    original_name = secure_filename(video.filename)

    if not original_name or not allowed_video(original_name):
        return jsonify({"error": "Use an MP4 or WebM video."}), 400

    video.stream.seek(0, os.SEEK_END)
    video_size = video.stream.tell()
    video.stream.seek(0)

    if video_size <= 0:
        return jsonify({"error": "Video file is empty."}), 400

    if video_size > MAX_VIDEO_SIZE:
        return jsonify({"error": "Video must be 50 MB or smaller."}), 400

    extension = original_name.rsplit(".", 1)[1].lower()

    header = video.stream.read(12)
    video.stream.seek(0)

    valid_signature = (
        header[4:8] == b"ftyp"
        if extension == "mp4"
        else header.startswith(bytes.fromhex("1a45dfa3"))
    )

    if not valid_signature:
        return jsonify({"error": "Invalid video file format."}), 400

    stored_filename = f"{uuid.uuid4().hex}.{extension}"
    video_path = os.path.join(CHAT_VIDEO_UPLOAD_FOLDER, stored_filename)

    os.makedirs(CHAT_VIDEO_UPLOAD_FOLDER, exist_ok=True)
    video.save(video_path)

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content="Video",
        message_type="video",
        video_filename=stored_filename,
        video_original_name=original_name
    )

    try:
        db.session.add(message)
        db.session.commit()
    except Exception:
        db.session.rollback()
        if os.path.exists(video_path):
            os.remove(video_path)
        raise

    message_data = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "message_type": "video",
        "image_url": None,
        "image_original_name": None,
        "audio_url": None,
        "audio_original_name": None,
        "audio_duration_ms": None,
        "video_url": f"/chat/video/{stored_filename}",
        "video_original_name": original_name,
        "created_at": message.created_at.isoformat(),
        "read_at": None,
        "edited_at": None,
        "reply_to": None,
        "reactions": []
    }

    socketio.emit("new_message", message_data, to=f"user_{receiver.id}")
    socketio.emit("message_sent", message_data, to=f"user_{current_user.id}")

    return jsonify({
        "message": "Video sent successfully.",
        "data": message_data
    }), 201


@chat_bp.route("/conversation/<int:user_id>", methods=["GET"])
@login_required
def conversation(user_id):
    other_user = db.session.get(User, user_id)

    if other_user is None:
        return jsonify({
            "error": "User not found."
        }), 404

    messages = (
        Message.query
        .filter(
            or_(
                and_(
                    Message.sender_id == current_user.id,
                    Message.receiver_id == user_id,
                    Message.deleted_for_sender_at.is_(None)
                ),
                and_(
                    Message.sender_id == user_id,
                    Message.receiver_id == current_user.id,
                    Message.deleted_for_receiver_at.is_(None)
                )
            ),
            Message.deleted_for_everyone_at.is_(None)
        )
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )

    return jsonify({
        "user": {
            "id": other_user.id,
            "username": other_user.username
        },
        "messages": [
            {
                "id": message.id,
                "sender_id": message.sender_id,
                "receiver_id": message.receiver_id,
                "content": message.content,
                "message_type": message.message_type,
                "image_url": (
                    f"/chat/images/{message.image_filename}"
                    if message.image_filename
                    else None
                ),
                "image_original_name": message.image_original_name,
                "audio_url": (
                    f"/chat/audio/{message.audio_filename}"
                    if message.audio_filename
                    else None
                ),
                "audio_original_name": message.audio_original_name,
                "audio_duration_ms": message.audio_duration_ms,
                "video_url": (
                    f"/chat/video/{message.video_filename}"
                    if message.video_filename
                    else None
                ),
                "video_original_name": message.video_original_name,
                "created_at": message.created_at.isoformat(),
                "read_at": (
                    message.read_at.isoformat()
                    if message.read_at
                    else None
                ),
                "edited_at": (
                    message.edited_at.isoformat()
                    if message.edited_at
                    else None
                ),
                "reply_to": serialize_reply_for_viewer(
                    message.reply_to_message,
                    current_user.id
                ),
                "reactions": [
                    {
                        "user_id": reaction.user_id,
                        "username": reaction.user.username,
                        "emoji": reaction.emoji
                    }
                    for reaction in message.reactions
                ]
            }
            for message in messages
        ]
    }), 200


# ---------------------------------------------------------
# Socket.IO real-time chat
# ---------------------------------------------------------

from flask_socketio import join_room, emit


# Number of active Socket.IO connections for each user.
# This prevents a user with multiple browser tabs from being
# marked offline when only one tab disconnects.
online_users = {}


@socketio.on("connect")
def socket_connect():
    if not current_user.is_authenticated:
        return False

    user_id = current_user.id

    # Every authenticated user gets a private room.
    room = f"user_{user_id}"
    join_room(room)

    online_users[user_id] = online_users.get(user_id, 0) + 1

    # Tell connected clients that this user is online.
    emit(
        "user_status",
        {
            "user_id": user_id,
            "status": "online"
        },
        broadcast=True
    )

    # Give this newly connected client the current online-user list.
    emit(
        "online_users",
        {
            "user_ids": list(online_users.keys())
        }
    )

    print(
        f"Socket connected: {current_user.username} "
        f"(user {user_id})"
    )


@socketio.on("mark_read")
def socket_mark_read(data):
    if not current_user.is_authenticated:
        return

    data = data or {}

    try:
        sender_id = int(data.get("sender_id"))
    except (TypeError, ValueError):
        return

    if sender_id == current_user.id:
        return

    # Mark unread messages sent by this user to the current user.
    messages = db.session.execute(
        db.select(Message).where(
            Message.sender_id == sender_id,
            Message.receiver_id == current_user.id,
            Message.read_at.is_(None)
        )
    ).scalars().all()

    if not messages:
        return

    read_at = datetime.now(timezone.utc)

    message_ids = []

    for message in messages:
        message.read_at = read_at
        message_ids.append(message.id)

    db.session.commit()

    receipt_data = {
        "reader_id": current_user.id,
        "message_ids": message_ids,
        "read_at": read_at.isoformat()
    }

    # Tell the original sender that these messages were read.
    emit(
        "messages_read",
        receipt_data,
        to=f"user_{sender_id}"
    )

    # Also confirm to the reader's own connection.
    emit(
        "messages_read",
        receipt_data
    )


@socketio.on("typing")
def socket_typing(data):
    if not current_user.is_authenticated:
        return

    data = data or {}

    try:
        receiver_id = int(data.get("receiver_id"))
    except (TypeError, ValueError):
        return

    if receiver_id == current_user.id:
        return

    is_typing = bool(data.get("is_typing"))

    emit(
        "typing_status",
        {
            "user_id": current_user.id,
            "username": current_user.username,
            "is_typing": is_typing
        },
        to=f"user_{receiver_id}"
    )


@socketio.on("send_message")
def socket_send_message(data):
    if not current_user.is_authenticated:
        emit("error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    receiver_id = data.get("receiver_id")
    content = str(data.get("content", "")).strip()
    reply_to_message_id = data.get("reply_to_message_id")

    if not receiver_id or not content:
        emit("error", {
            "error": "receiver_id and content are required."
        })
        return

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        emit("error", {
            "error": "receiver_id must be a valid integer."
        })
        return

    if receiver_id == current_user.id:
        emit("error", {
            "error": "You cannot send a message to yourself."
        })
        return

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        emit("error", {
            "error": "Receiver not found."
        })
        return

    reply_to_message = None

    if reply_to_message_id is not None:
        try:
            reply_to_message_id = int(reply_to_message_id)
        except (TypeError, ValueError):
            emit("error", {
                "error": "Invalid reply message ID."
            })
            return

        reply_to_message = db.session.get(
            Message,
            reply_to_message_id
        )

        if reply_to_message is None:
            emit("error", {
                "error": "Reply message not found."
            })
            return

        same_conversation = (
            (
                reply_to_message.sender_id == current_user.id
                and
                reply_to_message.receiver_id == receiver.id
            )
            or
            (
                reply_to_message.sender_id == receiver.id
                and
                reply_to_message.receiver_id == current_user.id
            )
        )

        if not same_conversation:
            emit("error", {
                "error": "You cannot reply to that message."
            })
            return

        if reply_to_message.deleted_for_everyone_at is not None:
            emit("error", {
                "error": "You cannot reply to a deleted message."
            })
            return

        if (
            reply_to_message.sender_id == current_user.id
            and
            reply_to_message.deleted_for_sender_at is not None
        ):
            emit("error", {
                "error": "You cannot reply to a deleted message."
            })
            return

        if (
            reply_to_message.receiver_id == current_user.id
            and
            reply_to_message.deleted_for_receiver_at is not None
        ):
            emit("error", {
                "error": "You cannot reply to a deleted message."
            })
            return

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content=content,
        reply_to_message_id=(
            reply_to_message.id
            if reply_to_message
            else None
        )
    )

    db.session.add(message)
    db.session.commit()

    message_data = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "message_type": message.message_type,
        "image_url": None,
        "image_original_name": None,
        "created_at": message.created_at.isoformat(),
        "read_at": (
            message.read_at.isoformat()
            if message.read_at
            else None
        ),
        "edited_at": (
            message.edited_at.isoformat()
            if message.edited_at
            else None
        ),
        "reactions": []
    }

    receiver_message_data = {
        **message_data,
        "reply_to": serialize_reply_for_viewer(
            reply_to_message,
            receiver.id
        )
    }

    sender_message_data = {
        **message_data,
        "reply_to": serialize_reply_for_viewer(
            reply_to_message,
            current_user.id
        )
    }

    # Deliver immediately to the recipient's private room.
    emit(
        "new_message",
        receiver_message_data,
        to=f"user_{receiver.id}"
    )

    # Confirm the saved message back to the sender.
    emit(
        "message_sent",
        sender_message_data
    )


@socketio.on("delete_message")
def socket_delete_message(data):
    if not current_user.is_authenticated:
        emit("delete_message_error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        emit("delete_message_error", {
            "error": "Invalid message ID."
        })
        return

    delete_type = data.get("delete_type")

    if delete_type not in ("me", "everyone"):
        emit("delete_message_error", {
            "error": "Invalid deletion type."
        })
        return

    message = db.session.get(Message, message_id)

    if message is None:
        emit("delete_message_error", {
            "error": "Message not found."
        })
        return

    is_sender = message.sender_id == current_user.id
    is_receiver = message.receiver_id == current_user.id

    # A user outside this conversation cannot delete the message.
    if not is_sender and not is_receiver:
        emit("delete_message_error", {
            "error": "You cannot delete this message."
        })
        return

    deleted_at = datetime.now(timezone.utc)

    if delete_type == "everyone":
        # Only the original sender may delete for everyone.
        if not is_sender:
            emit("delete_message_error", {
                "error": "Only the sender can delete for everyone."
            })
            return

        attachment_path = None

        if (
            message.message_type == "image"
            and message.image_filename
        ):
            attachment_path = os.path.join(
                CHAT_IMAGE_UPLOAD_FOLDER,
                message.image_filename
            )

        elif (
            message.message_type == "audio"
            and message.audio_filename
        ):
            attachment_path = os.path.join(
                CHAT_AUDIO_UPLOAD_FOLDER,
                message.audio_filename
            )

        elif (
            message.message_type == "video"
            and message.video_filename
        ):
            attachment_path = os.path.join(
                CHAT_VIDEO_UPLOAD_FOLDER,
                message.video_filename
            )

        message.deleted_for_everyone_at = deleted_at
        db.session.commit()

        # Remove the attachment only after the database
        # successfully records deletion for everyone.
        if attachment_path and os.path.isfile(attachment_path):
            try:
                os.remove(attachment_path)
            except OSError as error:
                print(
                    "Could not remove deleted chat attachment:",
                    error
                )

        deletion_data = {
            "message_id": message.id,
            "delete_type": "everyone"
        }

        # Remove it immediately for the receiver.
        emit(
            "message_deleted",
            deletion_data,
            to=f"user_{message.receiver_id}"
        )

        # Remove it immediately for the sender.
        emit(
            "message_deleted",
            deletion_data
        )

        return

    # Delete only from the current user's view.
    if is_sender:
        message.deleted_for_sender_at = deleted_at
    else:
        message.deleted_for_receiver_at = deleted_at

    db.session.commit()

    emit(
        "message_deleted",
        {
            "message_id": message.id,
            "delete_type": "me"
        }
    )


@socketio.on("edit_message")
def socket_edit_message(data):
    if not current_user.is_authenticated:
        emit("edit_message_error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        emit("edit_message_error", {
            "error": "Invalid message ID."
        })
        return

    content = str(data.get("content", "")).strip()

    if not content:
        emit("edit_message_error", {
            "error": "Message cannot be empty."
        })
        return

    message = db.session.get(Message, message_id)

    if message is None:
        emit("edit_message_error", {
            "error": "Message not found."
        })
        return

    # Only the original sender may edit a message.
    if message.sender_id != current_user.id:
        emit("edit_message_error", {
            "error": "You can only edit your own messages."
        })
        return

    # Image messages cannot be edited as text.
    if message.message_type != "text":
        emit("edit_message_error", {
            "error": "Image messages cannot be edited."
        })
        return

    # A message deleted for everyone can no longer be edited.
    if message.deleted_for_everyone_at is not None:
        emit("edit_message_error", {
            "error": "A deleted message cannot be edited."
        })
        return

    # A sender who deleted the message from their own view
    # should not be able to edit it afterward.
    if message.deleted_for_sender_at is not None:
        emit("edit_message_error", {
            "error": "A deleted message cannot be edited."
        })
        return

    message.content = content
    message.edited_at = datetime.now(timezone.utc)

    db.session.commit()

    edit_data = {
        "message_id": message.id,
        "sender_id": message.sender_id,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "edited_at": message.edited_at.isoformat()
    }

    # Update the receiver immediately.
    emit(
        "message_edited",
        edit_data,
        to=f"user_{message.receiver_id}"
    )

    # Update the sender immediately.
    emit(
        "message_edited",
        edit_data
    )


@socketio.on("react_message")
def socket_react_message(data):
    if not current_user.is_authenticated:
        emit("reaction_error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        emit("reaction_error", {
            "error": "Invalid message ID."
        })
        return

    emoji = str(data.get("emoji", "")).strip()

    allowed_emojis = {
        "👍",
        "❤️",
        "😂",
        "😮",
        "😢",
        "🔥"
    }

    if emoji not in allowed_emojis:
        emit("reaction_error", {
            "error": "Invalid reaction."
        })
        return

    message = db.session.get(Message, message_id)

    if message is None:
        emit("reaction_error", {
            "error": "Message not found."
        })
        return

    is_sender = message.sender_id == current_user.id
    is_receiver = message.receiver_id == current_user.id

    if not is_sender and not is_receiver:
        emit("reaction_error", {
            "error": "You cannot react to this message."
        })
        return

    if message.deleted_for_everyone_at is not None:
        emit("reaction_error", {
            "error": "You cannot react to a deleted message."
        })
        return

    if is_sender and message.deleted_for_sender_at is not None:
        emit("reaction_error", {
            "error": "You cannot react to a deleted message."
        })
        return

    if is_receiver and message.deleted_for_receiver_at is not None:
        emit("reaction_error", {
            "error": "You cannot react to a deleted message."
        })
        return

    reaction = db.session.execute(
        db.select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.user_id == current_user.id
        )
    ).scalar_one_or_none()

    action = "added"

    if reaction is None:
        reaction = MessageReaction(
            message_id=message.id,
            user_id=current_user.id,
            emoji=emoji
        )
        db.session.add(reaction)

    elif reaction.emoji == emoji:
        db.session.delete(reaction)
        action = "removed"

    else:
        reaction.emoji = emoji
        action = "changed"

    db.session.commit()

    reactions = db.session.execute(
        db.select(MessageReaction)
        .where(MessageReaction.message_id == message.id)
        .order_by(MessageReaction.id.asc())
    ).scalars().all()

    reaction_data = {
        "message_id": message.id,
        "user_id": current_user.id,
        "username": current_user.username,
        "emoji": (
            emoji
            if action != "removed"
            else None
        ),
        "action": action,
        "reactions": [
            {
                "user_id": item.user_id,
                "username": item.user.username,
                "emoji": item.emoji
            }
            for item in reactions
        ]
    }

    other_user_id = (
        message.receiver_id
        if is_sender
        else message.sender_id
    )

    emit(
        "message_reaction",
        reaction_data,
        to=f"user_{other_user_id}"
    )

    emit(
        "message_reaction",
        reaction_data
    )


@socketio.on("disconnect")
def socket_disconnect():
    if not current_user.is_authenticated:
        return

    user_id = current_user.id

    if user_id in online_users:
        online_users[user_id] -= 1

        if online_users[user_id] <= 0:
            del online_users[user_id]

            emit(
                "user_status",
                {
                    "user_id": user_id,
                    "status": "offline"
                },
                broadcast=True
            )

    print(
        f"Socket disconnected: {current_user.username} "
        f"(user {user_id})"
    )
