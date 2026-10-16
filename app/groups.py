import os
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from PIL import Image, UnidentifiedImageError

from .chat import (
    validate_shared_contact,
    CHAT_IMAGE_UPLOAD_FOLDER,
    CHAT_AUDIO_UPLOAD_FOLDER,
    CHAT_VIDEO_UPLOAD_FOLDER,
    MAX_IMAGE_SIZE,
    MAX_AUDIO_SIZE,
    MAX_SHARED_AUDIO_SIZE,
    allowed_shared_audio,
    valid_shared_audio_signature,
    MAX_VIDEO_SIZE,
    allowed_image,
    allowed_audio,
    allowed_video,
    allowed_document,
    CHAT_DOCUMENT_UPLOAD_FOLDER,
    MAX_DOCUMENT_SIZE
)
from flask_login import current_user, login_required

from .extensions import db, socketio
from .models import User, ChatGroup, GroupMember, GroupMessage, GroupMessageReaction


groups_bp = Blueprint(
    "groups",
    __name__,
    url_prefix="/groups"
)



@groups_bp.route("/", methods=["GET"])
@login_required
def list_groups():
    memberships = (
        GroupMember.query
        .filter_by(user_id=current_user.id)
        .order_by(GroupMember.joined_at.desc())
        .all()
    )

    groups = []

    for membership in memberships:
        group = ChatGroup.query.get(membership.group_id)

        if group is None:
            continue

        member_count = GroupMember.query.filter_by(
            group_id=group.id
        ).count()

        unread_count = GroupMessage.query.filter(
            GroupMessage.group_id == group.id,
            GroupMessage.id > membership.last_read_message_id,
            GroupMessage.sender_id != current_user.id
        ).count()

        groups.append({
            "unread_count": unread_count,
            "id": group.id,
            "name": group.name,
            "created_by": group.created_by,
            "member_count": member_count,
            "role": membership.role,
            "created_at": group.created_at.isoformat()
        })

    return jsonify({"groups": groups}), 200


@groups_bp.route("/create", methods=["POST"])
@login_required
def create_group():
    data = request.get_json(silent=True) or {}

    name = data.get("name")
    member_ids = data.get("member_ids", [])

    if not isinstance(name, str) or not name.strip():
        return jsonify({
            "error": "Group name is required."
        }), 400

    name = name.strip()

    if len(name) > 100:
        return jsonify({
            "error": "Group name cannot exceed 100 characters."
        }), 400

    if not isinstance(member_ids, list):
        return jsonify({
            "error": "member_ids must be a list."
        }), 400

    try:
        member_ids = [int(user_id) for user_id in member_ids]
    except (TypeError, ValueError):
        return jsonify({
            "error": "All member IDs must be valid integers."
        }), 400

    member_ids = list(set(member_ids))
    member_ids = [
        user_id for user_id in member_ids
        if user_id != current_user.id
    ]

    if member_ids:
        existing_users = User.query.filter(
            User.id.in_(member_ids)
        ).all()

        if len(existing_users) != len(member_ids):
            return jsonify({
                "error": "One or more selected users do not exist."
            }), 404

    group = ChatGroup(
        name=name,
        created_by=current_user.id
    )

    db.session.add(group)
    db.session.flush()

    creator_membership = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        role="admin"
    )

    db.session.add(creator_membership)

    for user_id in member_ids:
        membership = GroupMember(
            group_id=group.id,
            user_id=user_id,
            role="member"
        )
        db.session.add(membership)

    db.session.commit()

    return jsonify({
        "message": "Group created successfully.",
        "group": {
            "id": group.id,
            "name": group.name,
            "created_by": group.created_by,
            "member_count": len(member_ids) + 1,
            "created_at": group.created_at.isoformat()
        }
    }), 201


@groups_bp.route("/<int:group_id>/messages", methods=["GET"])
@login_required
def get_group_messages(group_id):
    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return jsonify({
            "error": "Group not found."
        }), 404

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({
            "error": "You are not a member of this group."
        }), 403

    messages = (
        GroupMessage.query
        .filter_by(group_id=group_id)
        .order_by(
            GroupMessage.created_at.asc(),
            GroupMessage.id.asc()
        )
        .limit(100)
        .all()
    )

    # Mark messages loaded in this group as read.
    if messages:
        latest_message_id = max(message.id for message in messages)

        if latest_message_id > membership.last_read_message_id:
            membership.last_read_message_id = latest_message_id
            db.session.commit()

    return jsonify({
        "group_id": group.id,
        "group_name": group.name,
        "messages": [
            {
                "id": message.id,
                "sender_id": message.sender_id,
                "sender_username": message.sender.username,
                "content": message.content,
                "message_type": message.message_type,
                "is_forwarded": bool(message.is_forwarded),
                "image_url": (
                    f"/groups/{group_id}/media/{message.id}"
                    if message.message_type == "image"
                    and message.image_filename
                    else None
                ),
                "video_url": (
                    f"/groups/{group_id}/media/{message.id}"
                    if message.message_type == "video"
                    and message.video_filename
                    else None
                ),
                "audio_url": (
                    f"/groups/{group_id}/media/{message.id}"
                    if message.message_type == "audio"
                    and message.audio_filename
                    else None
                ),
                "audio_original_name": message.audio_original_name,
                "audio_duration_ms": message.audio_duration_ms,
                "document_url": (
                    f"/groups/{group_id}/media/{message.id}"
                    if message.message_type == "document"
                    and message.document_filename
                    else None
                ),
                "document_original_name": message.document_original_name,
                "document_size": message.document_size,
                "created_at": message.created_at.isoformat(),
                "reply_to": (
                    {
                        "id": message.reply_to_message.id,
                        "sender_id": message.reply_to_message.sender_id,
                        "sender_username": message.reply_to_message.sender.username,
                        "content": message.reply_to_message.content
                    }
                    if message.reply_to_message else None
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


@groups_bp.route("/<int:group_id>/mark-read", methods=["POST"])
@login_required
def mark_group_read(group_id):
    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({
            "error": "You are not a member of this group."
        }), 403

    data = request.get_json(silent=True) or {}

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        return jsonify({
            "error": "A valid message ID is required."
        }), 400

    message = GroupMessage.query.filter_by(
        id=message_id,
        group_id=group_id
    ).first()

    if message is None:
        return jsonify({
            "error": "Message not found in this group."
        }), 404

    if message.id > membership.last_read_message_id:
        membership.last_read_message_id = message.id
        db.session.commit()

    return jsonify({
        "success": True,
        "group_id": group_id,
        "last_read_message_id": membership.last_read_message_id
    }), 200



@groups_bp.route("/<int:group_id>/send-contact", methods=["POST"])
@login_required
def send_group_contact(group_id):
    import json

    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return jsonify({"error": "Group not found."}), 404

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({
            "error": "You are not a member of this group."
        }), 403

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON object is required."
        }), 400

    contact, error = validate_shared_contact(
        data.get("name"),
        data.get("phone")
    )

    if error:
        return jsonify({"error": error}), 400

    message = GroupMessage(
        group_id=group_id,
        sender_id=current_user.id,
        content=json.dumps(contact, ensure_ascii=False),
        message_type="contact"
    )

    db.session.add(message)
    db.session.commit()

    message_data = {
        "id": message.id,
        "group_id": message.group_id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "content": message.content,
        "message_type": message.message_type,
        "contact_name": contact["name"],
        "contact_phone": contact["phone"],
        "created_at": message.created_at.isoformat(),
        "reply_to": None
    }

    socketio.emit(
        "new_group_message",
        message_data,
        to=f"group_{group_id}"
    )

    socketio.emit(
        "group_message_notification",
        {
            "group_id": group_id,
            "message_id": message.id,
            "sender_id": message.sender_id
        },
        to=f"group_notify_{group_id}"
    )

    return jsonify({
        "message": "Contact shared successfully.",
        "data": message_data
    }), 201


@groups_bp.route("/<int:group_id>/send", methods=["POST"])
@login_required
def send_group_message(group_id):
    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return jsonify({
            "error": "Group not found."
        }), 404

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({
            "error": "You are not a member of this group."
        }), 403

    data = request.get_json(silent=True) or {}
    content = data.get("content")

    if not isinstance(content, str) or not content.strip():
        return jsonify({
            "error": "Message content is required."
        }), 400

    content = content.strip()

    if len(content) > 10000:
        return jsonify({
            "error": "Message cannot exceed 10000 characters."
        }), 400

    reply_to_message_id = data.get("reply_to_message_id")
    reply_target = None

    if reply_to_message_id is not None:
        if (
            isinstance(reply_to_message_id, bool)
            or not isinstance(reply_to_message_id, int)
        ):
            return jsonify({
                "error": "Invalid reply message ID."
            }), 400

        reply_target = db.session.get(
            GroupMessage,
            reply_to_message_id
        )

        if (
            reply_target is None
            or reply_target.group_id != group_id
        ):
            return jsonify({
                "error": "Reply message not found in this group."
            }), 404

    message = GroupMessage(
        group_id=group_id,
        sender_id=current_user.id,
        content=content,
        message_type="text",
        reply_to_message_id=(
            reply_target.id if reply_target else None
        )
    )

    db.session.add(message)
    db.session.commit()

    message_data = {
        "id": message.id,
        "group_id": message.group_id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "content": message.content,
        "message_type": message.message_type,
        "created_at": message.created_at.isoformat(),
        "reply_to": (
            {
                "id": reply_target.id,
                "sender_id": reply_target.sender_id,
                "sender_username": reply_target.sender.username,
                "content": reply_target.content
            }
            if reply_target else None
        )
    }

    socketio.emit(
        "new_group_message",
        message_data,
        to=f"group_{group_id}"
    )

    # Notify members even when this group is not selected.
    socketio.emit(
        "group_message_notification",
        {
            "group_id": group_id,
            "message_id": message.id,
            "sender_id": message.sender_id
        },
        to=f"group_notify_{group_id}"
    )

    return jsonify({
        "message": "Group message sent successfully.",
        "data": message_data
    }), 201



@groups_bp.route("/<int:group_id>/upload-media", methods=["POST"])
@login_required
def upload_group_media(group_id):
    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return jsonify({"error": "Group not found."}), 404

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({"error": "Not a group member."}), 403

    media = request.files.get("media")

    if media is None or not media.filename:
        return jsonify({"error": "Media file is required."}), 400

    original_name = secure_filename(media.filename)

    if not original_name or "." not in original_name:
        return jsonify({"error": "Invalid filename."}), 400

    extension = original_name.rsplit(".", 1)[1].lower()

    if allowed_image(original_name):
        media_type = "image"
        max_size = MAX_IMAGE_SIZE
        folder = CHAT_IMAGE_UPLOAD_FOLDER

        expected_formats = {
            "png": "PNG",
            "jpg": "JPEG",
            "jpeg": "JPEG",
            "gif": "GIF",
            "webp": "WEBP"
        }

        try:
            with Image.open(media.stream) as img:
                detected_format = img.format
                img.verify()
        except (UnidentifiedImageError, OSError, SyntaxError):
            return jsonify({"error": "Invalid image file."}), 400

        media.stream.seek(0)

        if detected_format != expected_formats.get(extension):
            return jsonify({"error": "Image format mismatch."}), 400

    elif allowed_video(original_name):
        media_type = "video"
        max_size = MAX_VIDEO_SIZE
        folder = CHAT_VIDEO_UPLOAD_FOLDER

        header = media.stream.read(12)
        media.stream.seek(0)

        valid_signature = (
            header[4:8] == b"ftyp"
            if extension == "mp4"
            else header.startswith(bytes.fromhex("1a45dfa3"))
        )

        if not valid_signature:
            return jsonify({"error": "Invalid video file."}), 400

    elif (
        request.form.get("shared_audio") == "1"
        and allowed_shared_audio(original_name)
    ):
        media_type = "audio"
        max_size = MAX_SHARED_AUDIO_SIZE
        folder = CHAT_AUDIO_UPLOAD_FOLDER
        duration_ms = None

        if not valid_shared_audio_signature(media, extension):
            return jsonify({"error": "Invalid shared audio file."}), 400

    elif allowed_audio(original_name):
        media_type = "audio"
        max_size = MAX_AUDIO_SIZE
        folder = CHAT_AUDIO_UPLOAD_FOLDER

        try:
            duration_ms = int(request.form.get("duration_ms"))
        except (TypeError, ValueError):
            return jsonify({
                "error": "A valid voice-note duration is required."
            }), 400

        if not 0 < duration_ms <= 305000:
            return jsonify({
                "error": "Voice notes cannot exceed five minutes."
            }), 400

        header = media.stream.read(12)
        media.stream.seek(0)

        valid_signature = (
            header.startswith(bytes.fromhex("1a45dfa3"))
            if extension == "webm"
            else header.startswith(b"OggS")
            if extension == "ogg"
            else len(header) >= 8 and header[4:8] == b"ftyp"
        )

        if not valid_signature:
            return jsonify({
                "error": "Invalid audio file."
            }), 400

    elif allowed_document(original_name):
        media_type = "document"
        max_size = MAX_DOCUMENT_SIZE
        folder = CHAT_DOCUMENT_UPLOAD_FOLDER

        header = media.stream.read(8)
        media.stream.seek(0)

        if extension == "pdf" and not header.startswith(b"%PDF-"):
            return jsonify({"error": "Invalid PDF document."}), 400

        if extension in ("docx", "xlsx") and not header.startswith(b"PK"):
            return jsonify({"error": "Invalid Office document."}), 400

    else:
        return jsonify({"error": "Unsupported media format."}), 400

    media.stream.seek(0, os.SEEK_END)
    file_size = media.stream.tell()
    media.stream.seek(0)

    if file_size <= 0 or file_size > max_size:
        return jsonify({"error": "Invalid media file size."}), 400

    stored_filename = f"{uuid.uuid4().hex}.{extension}"
    os.makedirs(folder, exist_ok=True)
    saved_path = os.path.join(folder, stored_filename)

    media.save(saved_path)

    message = GroupMessage(
        group_id=group_id,
        sender_id=current_user.id,
        content="",
        message_type=media_type,
        audio_filename=stored_filename if media_type == "audio" else None,
        audio_original_name=original_name if media_type == "audio" else None,
        audio_duration_ms=duration_ms if media_type == "audio" else None,
        image_filename=stored_filename if media_type == "image" else None,
        image_original_name=original_name if media_type == "image" else None,
        video_filename=stored_filename if media_type == "video" else None,
        video_original_name=original_name if media_type == "video" else None,
        document_filename=stored_filename if media_type == "document" else None,
        document_original_name=original_name if media_type == "document" else None,
        document_size=file_size if media_type == "document" else None
    )

    try:
        db.session.add(message)
        db.session.commit()
    except Exception:
        db.session.rollback()
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise

    media_url = f"/groups/{group_id}/media/{message.id}"

    message_data = {
        "id": message.id,
        "group_id": group_id,
        "sender_id": current_user.id,
        "sender_username": current_user.username,
        "content": "",
        "message_type": media_type,
        "image_url": media_url if media_type == "image" else None,
        "video_url": media_url if media_type == "video" else None,
        "audio_url": media_url if media_type == "audio" else None,
        "audio_original_name": message.audio_original_name,
        "audio_duration_ms": message.audio_duration_ms,
        "document_url": media_url if media_type == "document" else None,
        "document_original_name": message.document_original_name,
        "document_size": message.document_size,
        "created_at": message.created_at.isoformat()
    }

    socketio.emit(
        "new_group_message",
        message_data,
        to=f"group_{group_id}"
    )

    # Notify members even when this group is not selected.
    socketio.emit(
        "group_message_notification",
        {
            "group_id": group_id,
            "message_id": message.id,
            "sender_id": message.sender_id
        },
        to=f"group_notify_{group_id}"
    )

    return jsonify({
        "message": "Group media uploaded successfully.",
        "data": message_data
    }), 201


@groups_bp.route("/<int:group_id>/media/<int:message_id>")
@login_required
def serve_group_media(group_id, message_id):
    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({"error": "Access denied."}), 403

    message = GroupMessage.query.filter_by(
        id=message_id,
        group_id=group_id
    ).first()

    if message is None:
        return jsonify({"error": "Media not found."}), 404

    if message.message_type == "image" and message.image_filename:
        folder = CHAT_IMAGE_UPLOAD_FOLDER
        filename = message.image_filename
    elif message.message_type == "video" and message.video_filename:
        folder = CHAT_VIDEO_UPLOAD_FOLDER
        filename = message.video_filename
    elif message.message_type == "audio" and message.audio_filename:
        folder = CHAT_AUDIO_UPLOAD_FOLDER
        filename = message.audio_filename
    elif message.message_type == "document" and message.document_filename:
        return send_from_directory(
            CHAT_DOCUMENT_UPLOAD_FOLDER,
            message.document_filename,
            as_attachment=True,
            download_name=message.document_original_name or "document"
        )
    else:
        return jsonify({"error": "Media not found."}), 404

    return send_from_directory(folder, filename)


# ---------------------------------------------------------
# Active group voice/video calls.
# Key: group ID
# Value: call type and connected participants.
#
# Initial implementation uses in-memory state.
# A shared store will be needed for multi-worker deployment.
active_group_calls = {}


# Socket.IO group chat rooms
# ---------------------------------------------------------

from flask_socketio import join_room, leave_room, emit


@socketio.on("subscribe_group_notifications")
def subscribe_group_notifications():
    if not current_user.is_authenticated:
        return {"success": False, "error": "Authentication required."}

    memberships = GroupMember.query.filter_by(
        user_id=current_user.id
    ).all()

    for membership in memberships:
        join_room(f"group_notify_{membership.group_id}")

    return {
        "success": True,
        "group_ids": [membership.group_id for membership in memberships]
    }


@socketio.on("join_group")
def socket_join_group(data):
    if not current_user.is_authenticated:
        return {"error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"error": "Invalid group ID."}

    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return {"error": "Group not found."}

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return {"error": "You are not a member of this group."}

    room = f"group_{group_id}"

    join_room(room)

    emit("group_joined", {
        "group_id": group_id,
        "group_name": group.name
    })

    return {
        "success": True,
        "group_id": group_id
    }


@socketio.on("leave_group")
def socket_leave_group(data):
    if not current_user.is_authenticated:
        return {"error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"error": "Invalid group ID."}

    room = f"group_{group_id}"

    leave_room(room)

    emit("group_left", {
        "group_id": group_id
    })

    return {
        "success": True,
        "group_id": group_id
    }


# ---------------------------------------------------------
# Start a group voice or video call
# ---------------------------------------------------------

@socketio.on("start_group_call")
def socket_start_group_call(data):
    if not current_user.is_authenticated:
        return {"success": False, "error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid group ID."}

    call_type = data.get("call_type")

    if call_type not in ("voice", "video"):
        return {"success": False, "error": "Invalid call type."}

    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return {"success": False, "error": "Group not found."}

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return {
            "success": False,
            "error": "You are not a member of this group."
        }

    if group_id in active_group_calls:
        return {
            "success": False,
            "error": "This group already has an active call."
        }

    call_id = str(uuid.uuid4())

    active_group_calls[group_id] = {
        "call_id": call_id,
        "call_type": call_type,
        "participants": {current_user.id},
        "connections": {current_user.id: request.sid}
    }

    join_room(f"group_call_{call_id}")

    member_ids = [
        member.user_id
        for member in GroupMember.query.filter_by(
            group_id=group_id
        ).all()
    ]

    notification = {
        "group_id": group_id,
        "group_name": group.name,
        "call_id": call_id,
        "call_type": call_type,
        "caller_id": current_user.id,
        "caller_username": current_user.username
    }

    for member_id in member_ids:
        if member_id != current_user.id:
            socketio.emit(
                "incoming_group_call",
                notification,
                to=f"user_{member_id}"
            )

    return {
        "success": True,
        "group_id": group_id,
        "call_id": call_id,
        "call_type": call_type
    }


# ---------------------------------------------------------
# Join an active group voice or video call
# ---------------------------------------------------------

@socketio.on("join_group_call")
def socket_join_group_call(data):
    if not current_user.is_authenticated:
        return {"success": False, "error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid group ID."}

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return {
            "success": False,
            "error": "You are not a member of this group."
        }

    call = active_group_calls.get(group_id)

    if call is None:
        return {
            "success": False,
            "error": "No active call in this group."
        }

    if data.get("call_id") != call["call_id"]:
        return {
            "success": False,
            "error": "Invalid or expired call."
        }

    existing_participants = [
        user_id
        for user_id in call["participants"]
        if user_id != current_user.id
    ]

    connections = call["connections"]
    existing_sid = connections.get(current_user.id)

    if existing_sid and existing_sid != request.sid:
        return {
            "success": False,
            "error": "You already joined this call in another tab."
        }

    if existing_sid == request.sid:
        join_room(f"group_call_{call['call_id']}")
        return {
            "success": True,
            "group_id": group_id,
            "call_id": call["call_id"],
            "call_type": call["call_type"],
            "participants": existing_participants
        }

    call["participants"].add(current_user.id)
    connections[current_user.id] = request.sid

    join_room(f"group_call_{call['call_id']}")

    for participant_id in existing_participants:
        socketio.emit(
            "group_call_participant_joined",
            {
                "group_id": group_id,
                "call_id": call["call_id"],
                "user_id": current_user.id,
                "username": current_user.username
            },
            to=connections[participant_id]
        )

    return {
        "success": True,
        "group_id": group_id,
        "call_id": call["call_id"],
        "call_type": call["call_type"],
        "participants": existing_participants
    }


# ---------------------------------------------------------
# Leave an active group voice or video call
# ---------------------------------------------------------

@socketio.on("leave_group_call")
def socket_leave_group_call(data):
    if not current_user.is_authenticated:
        return {"success": False, "error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid group ID."}

    call = active_group_calls.get(group_id)

    if call is None:
        return {
            "success": False,
            "error": "No active call in this group."
        }

    if data.get("call_id") != call["call_id"]:
        return {
            "success": False,
            "error": "Invalid or expired call."
        }

    user_id = current_user.id

    if user_id not in call["participants"]:
        return {
            "success": False,
            "error": "You are not participating in this call."
        }

    if call["connections"].get(user_id) != request.sid:
        return {
            "success": False,
            "error": "This browser connection is not in the call."
        }

    call["participants"].remove(user_id)
    call["connections"].pop(user_id, None)

    leave_room(f"group_call_{call['call_id']}")

    for participant_id in call["participants"]:
        socketio.emit(
            "group_call_participant_left",
            {
                "group_id": group_id,
                "call_id": call["call_id"],
                "user_id": user_id
            },
            to=call["connections"][participant_id]
        )

    if not call["participants"]:
        del active_group_calls[group_id]

        return {
            "success": True,
            "call_ended": True
        }

    return {
        "success": True,
        "call_ended": False,
        "remaining_participants": len(call["participants"])
    }


# ---------------------------------------------------------
# Group WebRTC signaling
# ---------------------------------------------------------

def forward_group_webrtc(data, event_name, payload_key, expected_type=None):
    if not current_user.is_authenticated:
        return {"success": False, "error": "Authentication required."}

    if not isinstance(data, dict):
        return {"success": False, "error": "Invalid signaling data."}

    try:
        group_id = int(data.get("group_id"))
        target_id = int(data.get("target_user_id"))
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid group or target ID."}

    call = active_group_calls.get(group_id)

    if call is None or data.get("call_id") != call["call_id"]:
        return {"success": False, "error": "Call not found."}

    sender_id = current_user.id

    if sender_id == target_id:
        return {"success": False, "error": "Cannot signal yourself."}

    participants = call["participants"]

    if sender_id not in participants or target_id not in participants:
        return {"success": False, "error": "User is not in this call."}

    connections = call["connections"]

    if connections.get(sender_id) != request.sid:
        return {
            "success": False,
            "error": "This browser connection is not in the call."
        }

    if not connections.get(target_id):
        return {
            "success": False,
            "error": "Target participant has not connected."
        }

    member_ids = {
        member.user_id
        for member in GroupMember.query.filter_by(group_id=group_id).all()
    }

    if sender_id not in member_ids or target_id not in member_ids:
        return {"success": False, "error": "Group membership required."}

    payload = data.get(payload_key)

    if not isinstance(payload, dict):
        return {"success": False, "error": "Invalid WebRTC payload."}

    if expected_type is not None:
        if payload.get("type") != expected_type:
            return {"success": False, "error": "Invalid SDP type."}

        sdp = payload.get("sdp")

        if not isinstance(sdp, str) or len(sdp) > 262144:
            return {"success": False, "error": "Invalid SDP."}

    else:
        candidate = payload.get("candidate")

        if not isinstance(candidate, str) or len(candidate) > 8192:
            return {"success": False, "error": "Invalid ICE candidate."}

    socketio.emit(
        event_name,
        {
            "group_id": group_id,
            "call_id": call["call_id"],
            "sender_id": sender_id,
            payload_key: payload
        },
        to=connections[target_id]
    )

    return {"success": True, "call_id": call["call_id"]}


@socketio.on("group_webrtc_offer")
def socket_group_webrtc_offer(data):
    return forward_group_webrtc(
        data, "group_webrtc_offer", "offer", "offer"
    )


@socketio.on("group_webrtc_answer")
def socket_group_webrtc_answer(data):
    return forward_group_webrtc(
        data, "group_webrtc_answer", "answer", "answer"
    )


@socketio.on("group_webrtc_ice_candidate")
def socket_group_webrtc_ice_candidate(data):
    return forward_group_webrtc(
        data, "group_webrtc_ice_candidate", "candidate"
    )


# ---------------------------------------------------------
# Clean up group calls after a browser disconnects
# ---------------------------------------------------------

def cleanup_disconnected_group_calls(user_id, sid):
    for group_id, call in list(active_group_calls.items()):
        connections = call["connections"]

        if connections.get(user_id) != sid:
            continue

        connections.pop(user_id, None)
        call["participants"].discard(user_id)

        for participant_id in call["participants"]:
            participant_sid = connections.get(participant_id)

            if participant_sid:
                socketio.emit(
                    "group_call_participant_left",
                    {
                        "group_id": group_id,
                        "call_id": call["call_id"],
                        "user_id": user_id,
                        "reason": "disconnected"
                    },
                    to=participant_sid
                )

        if not call["participants"]:
            del active_group_calls[group_id]


# Group message emoji reactions
@socketio.on("react_group_message")
def react_group_message(data):
    if not current_user.is_authenticated:
        return

    if not isinstance(data, dict):
        return

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        return

    emoji = data.get("emoji")

    allowed_emojis = {
        "👍", "❤️", "😂", "😮", "😢", "🔥"
    }

    if emoji not in allowed_emojis:
        return

    message = db.session.get(GroupMessage, message_id)

    if message is None:
        return

    membership = GroupMember.query.filter_by(
        group_id=message.group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return

    reaction = GroupMessageReaction.query.filter_by(
        message_id=message.id,
        user_id=current_user.id
    ).first()

    if reaction is None:
        reaction = GroupMessageReaction(
            message_id=message.id,
            user_id=current_user.id,
            emoji=emoji
        )

        db.session.add(reaction)

    elif reaction.emoji == emoji:
        db.session.delete(reaction)

    else:
        reaction.emoji = emoji

    db.session.commit()

    reactions = (
        GroupMessageReaction.query
        .filter_by(message_id=message.id)
        .order_by(GroupMessageReaction.id.asc())
        .all()
    )

    reaction_data = {
        "message_id": message.id,
        "group_id": message.group_id,
        "reactions": [
            {
                "user_id": item.user_id,
                "username": item.user.username,
                "emoji": item.emoji
            }
            for item in reactions
        ]
    }

    socketio.emit(
        "group_message_reaction",
        reaction_data,
        to=f"group_{message.group_id}"
    )
