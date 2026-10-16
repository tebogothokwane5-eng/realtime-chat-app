from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import or_, and_

from .extensions import db, socketio
from .models import StatusUpdate, Contact, StatusAllowedViewer



# BLACK PILL STATUS MEDIA CONFIGURATION

import os
import uuid

from pathlib import Path
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename

STATUS_UPLOAD_BASE = Path(__file__).resolve().parent / "uploads" / "statuses"

STATUS_IMAGE_FOLDER = STATUS_UPLOAD_BASE / "images"

ALLOWED_STATUS_IMAGE_EXTENSIONS = {
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp"
}

MAX_STATUS_IMAGE_SIZE = 10 * 1024 * 1024

STATUS_IMAGE_FOLDER.mkdir(parents=True, exist_ok=True)




# BLACK PILL VIDEO STATUS CONFIGURATION

import json
import subprocess

STATUS_VIDEO_FOLDER = STATUS_UPLOAD_BASE / "videos"

ALLOWED_STATUS_VIDEO_EXTENSIONS = {
    "mp4",
    "webm"
}

MAX_STATUS_VIDEO_SIZE = 50 * 1024 * 1024

MAX_STATUS_VIDEO_DURATION = 60

STATUS_VIDEO_FOLDER.mkdir(parents=True, exist_ok=True)


# BLACK PILL AUDIO STATUS CONFIGURATION

STATUS_AUDIO_FOLDER = STATUS_UPLOAD_BASE / "audio"

ALLOWED_STATUS_AUDIO_EXTENSIONS = {
    "mp3",
    "wav",
    "m4a",
    "webm"
}

MAX_STATUS_AUDIO_SIZE = 20 * 1024 * 1024

MAX_STATUS_AUDIO_DURATION = 300

STATUS_AUDIO_FOLDER.mkdir(parents=True, exist_ok=True)


# BLACK PILL PHOTO STATUS VALIDATION

def validate_status_image(upload):
    """Validate an uploaded Status image before saving it."""

    if upload is None or not upload.filename:
        return "Please select an image."

    extension = Path(upload.filename).suffix.lower().lstrip(".")

    if extension not in ALLOWED_STATUS_IMAGE_EXTENSIONS:
        return "Unsupported image format."

    upload.stream.seek(0)
    data = upload.stream.read(MAX_STATUS_IMAGE_SIZE + 1)

    if not data:
        return "The image is empty."

    if len(data) > MAX_STATUS_IMAGE_SIZE:
        return "Image exceeds the 10 MB limit."

    from io import BytesIO

    expected_formats = {
        "jpg": "JPEG",
        "jpeg": "JPEG",
        "png": "PNG",
        "gif": "GIF",
        "webp": "WEBP"
    }

    try:
        with Image.open(BytesIO(data)) as image:
            if image.format != expected_formats[extension]:
                return "Image format does not match its extension."

            image.verify()

    except (UnidentifiedImageError, OSError, ValueError):
        return "Invalid or corrupted image."

    finally:
        upload.stream.seek(0)

    return None

status_bp = Blueprint("status", __name__, url_prefix="/status")



# BLACK PILL PHOTO STATUS ENDPOINT


# BLACK PILL VIDEO STATUS VALIDATION

def validate_status_video(video_path):
    """Inspect a saved video using FFprobe."""

    video_path = Path(video_path)

    if not video_path.is_file():
        return {"error": "Video file not found."}

    if video_path.stat().st_size == 0:
        return {"error": "Video file is empty."}

    if video_path.stat().st_size > MAX_STATUS_VIDEO_SIZE:
        return {"error": "Video exceeds the 50 MB limit."}

    extension = video_path.suffix.lower().lstrip(".")

    if extension not in ALLOWED_STATUS_VIDEO_EXTENSIONS:
        return {"error": "Only MP4 and WebM videos are supported."}

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries",
                "format=format_name,duration:stream=codec_type,codec_name",
                "-of", "json",
                str(video_path)
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=True
        )

        metadata = json.loads(result.stdout)

    except (
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
        json.JSONDecodeError,
        OSError
    ):
        return {"error": "Invalid or unreadable video."}

    streams = metadata.get("streams", [])

    video_streams = [
        stream for stream in streams
        if stream.get("codec_type") == "video"
    ]

    audio_streams = [
        stream for stream in streams
        if stream.get("codec_type") == "audio"
    ]

    if not video_streams:
        return {"error": "File does not contain a video stream."}

    format_name = metadata.get("format", {}).get("format_name", "")
    detected_formats = set(format_name.split(","))

    if extension == "mp4":
        valid_format = bool(
            detected_formats.intersection(
                {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}
            )
        )
    else:
        valid_format = "matroska" in detected_formats or "webm" in detected_formats

    if not valid_format:
        return {"error": "Video format does not match its extension."}

    try:
        duration = float(metadata["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        return {"error": "Unable to determine video duration."}

    import math

    if not math.isfinite(duration) or duration <= 0:
        return {"error": "Invalid video duration."}

    if duration > MAX_STATUS_VIDEO_DURATION:
        return {"error": "Video must be 60 seconds or shorter."}

    return {
        "error": None,
        "duration": round(duration, 2),
        "has_audio": bool(audio_streams),
        "video_codec": video_streams[0].get("codec_name")
    }



# BLACK PILL VIDEO STATUS UPLOAD


# BLACK PILL AUDIO STATUS VALIDATION

def validate_status_audio(audio_path):
    """Validate an uploaded Audio Status using FFprobe."""

    import math

    audio_path = Path(audio_path)

    if not audio_path.is_file():
        return {"error": "Audio file not found."}

    size = audio_path.stat().st_size

    if size == 0:
        return {"error": "Audio file is empty."}

    if size > MAX_STATUS_AUDIO_SIZE:
        return {"error": "Audio exceeds the 20 MB limit."}

    extension = audio_path.suffix.lower().lstrip(".")

    if extension not in ALLOWED_STATUS_AUDIO_EXTENSIONS:
        return {"error": "Unsupported audio format."}

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries",
                "format=format_name,duration:"
                "stream=codec_type,codec_name:stream_disposition=attached_pic",
                "-of", "json",
                str(audio_path)
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=True
        )

        metadata = json.loads(result.stdout)

    except (
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
        json.JSONDecodeError,
        OSError
    ):
        return {"error": "Invalid or unreadable audio file."}

    streams = metadata.get("streams", [])

    audio_streams = [
        stream
        for stream in streams
        if stream.get("codec_type") == "audio"
    ]

    if not audio_streams:
        return {"error": "File does not contain audio."}

    # Allow embedded MP3 album artwork, but reject actual video.
    for stream in streams:
        if stream.get("codec_type") != "video":
            continue

        disposition = stream.get("disposition", {})

        if (
            extension == "mp3"
            and disposition.get("attached_pic") == 1
        ):
            continue

        return {"error": "Audio Status cannot contain video."}

    formats = set(
        metadata.get("format", {}).get("format_name", "").split(",")
    )

    valid_formats = {
        "mp3": {"mp3"},
        "wav": {"wav"},
        "m4a": {"mov", "mp4", "m4a"},
        "webm": {"matroska", "webm"}
    }

    if not formats.intersection(valid_formats[extension]):
        return {
            "error": "Audio format does not match its extension."
        }

    try:
        duration = float(metadata["format"]["duration"])
    except (KeyError, TypeError, ValueError):
        return {"error": "Unable to determine audio duration."}

    if not math.isfinite(duration) or duration <= 0:
        return {"error": "Invalid audio duration."}

    if duration > MAX_STATUS_AUDIO_DURATION:
        return {
            "error": "Audio Status must be 5 minutes or shorter."
        }

    return {
        "error": None,
        "duration": round(duration, 2),
        "audio_codec": audio_streams[0].get("codec_name")
    }



# BLACK PILL AUDIO STATUS UPLOAD ENDPOINT

@status_bp.route("/audio", methods=["POST"])
@login_required
def create_audio_status():
    from .models import User

    upload = request.files.get("audio")

    if upload is None or not upload.filename:
        return jsonify({"error": "Please select an audio file."}), 400

    extension = Path(upload.filename).suffix.lower()

    if extension.lstrip(".") not in ALLOWED_STATUS_AUDIO_EXTENSIONS:
        return jsonify({"error": "Unsupported audio format."}), 400

    caption = request.form.get("content", "").strip()

    if len(caption) > 500:
        return jsonify({
            "error": "Audio caption cannot exceed 500 characters."
        }), 400

    privacy = request.form.get("privacy", "contacts")

    if privacy not in ("everyone", "contacts", "selected"):
        return jsonify({"error": "Invalid privacy setting."}), 400

    selected_ids = []

    if privacy == "selected":
        raw_ids = request.form.getlist("selected_user_ids")

        try:
            selected_ids = [int(value) for value in raw_ids]
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid selected users."}), 400

        if (
            not selected_ids
            or len(selected_ids) > 100
            or any(user_id <= 0 for user_id in selected_ids)
            or len(set(selected_ids)) != len(selected_ids)
            or current_user.id in selected_ids
        ):
            return jsonify({"error": "Invalid selected users."}), 400

        existing_ids = {
            user.id
            for user in User.query.filter(
                User.id.in_(selected_ids)
            ).all()
        }

        if existing_ids != set(selected_ids):
            return jsonify({
                "error": "One or more users do not exist."
            }), 400

    elif request.form.getlist("selected_user_ids"):
        return jsonify({
            "error": "Selected users require selected privacy."
        }), 400

    upload.stream.seek(0, 2)
    size = upload.stream.tell()
    upload.stream.seek(0)

    if size == 0:
        return jsonify({"error": "Audio file is empty."}), 400

    if size > MAX_STATUS_AUDIO_SIZE:
        return jsonify({
            "error": "Audio exceeds the 20 MB limit."
        }), 400

    filename = f"{uuid.uuid4().hex}{extension}"
    destination = STATUS_AUDIO_FOLDER / filename

    try:
        upload.save(destination)

        validation = validate_status_audio(destination)

        if validation.get("error"):
            destination.unlink(missing_ok=True)
            return jsonify({
                "error": validation["error"]
            }), 400

        now = datetime.now(timezone.utc)

        status = StatusUpdate(
            user_id=current_user.id,
            status_type="audio",
            privacy=privacy,
            content=caption or None,
            media_filename=filename,
            created_at=now,
            expires_at=now + timedelta(hours=24)
        )

        db.session.add(status)
        db.session.flush()

        for user_id in selected_ids:
            db.session.add(
                StatusAllowedViewer(
                    status_id=status.id,
                    user_id=user_id
                )
            )

        db.session.commit()

    except Exception:
        db.session.rollback()
        destination.unlink(missing_ok=True)

        return jsonify({
            "error": "Unable to save Audio Status."
        }), 500

    socketio.emit(
        "status_updated",
        {
            "action": "created",
            "status_id": status.id
        }
    )

    return jsonify({
        "message": "Audio Status posted successfully.",
        "status": {
            "id": status.id,
            "status_type": status.status_type,
            "privacy": status.privacy,
            "duration": validation["duration"],
            "audio_codec": validation["audio_codec"],
            "expires_at": status.expires_at.isoformat()
        }
    }), 201


@status_bp.route("/video", methods=["POST"])
@login_required
def create_video_status():
    from .models import User

    upload = request.files.get("video")

    if upload is None or not upload.filename:
        return jsonify({"error": "Please select a video."}), 400

    extension = Path(upload.filename).suffix.lower()

    if extension not in (".mp4", ".webm"):
        return jsonify({
            "error": "Only MP4 and WebM videos are supported."
        }), 400

    # BLACK PILL VIDEO STATUS CAPTION
    caption = request.form.get("content", "").strip()

    if len(caption) > 500:
        return jsonify({
            "error": "Video caption cannot exceed 500 characters."
        }), 400

    privacy = request.form.get("privacy", "contacts")

    if privacy not in ("everyone", "contacts", "selected"):
        return jsonify({"error": "Invalid privacy setting."}), 400

    selected_ids = []

    if privacy == "selected":
        raw_ids = request.form.getlist("selected_user_ids")

        try:
            selected_ids = [int(value) for value in raw_ids]
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid selected users."}), 400

        if (
            not selected_ids
            or len(selected_ids) > 100
            or any(user_id <= 0 for user_id in selected_ids)
            or len(set(selected_ids)) != len(selected_ids)
            or current_user.id in selected_ids
        ):
            return jsonify({"error": "Invalid selected users."}), 400

        existing_ids = {
            user.id
            for user in User.query.filter(
                User.id.in_(selected_ids)
            ).all()
        }

        if existing_ids != set(selected_ids):
            return jsonify({
                "error": "One or more users do not exist."
            }), 400

    elif request.form.getlist("selected_user_ids"):
        return jsonify({
            "error": "Selected users require selected privacy."
        }), 400

    # Check upload size before saving.
    upload.stream.seek(0, 2)
    size = upload.stream.tell()
    upload.stream.seek(0)

    if size == 0:
        return jsonify({"error": "Video file is empty."}), 400

    if size > MAX_STATUS_VIDEO_SIZE:
        return jsonify({
            "error": "Video exceeds the 50 MB limit."
        }), 400

    filename = f"{uuid.uuid4().hex}{extension}"
    destination = STATUS_VIDEO_FOLDER / filename

    try:
        upload.save(destination)

        validation = validate_status_video(destination)

        if validation.get("error"):
            destination.unlink(missing_ok=True)
            return jsonify({
                "error": validation["error"]
            }), 400

        now = datetime.now(timezone.utc)

        status = StatusUpdate(
            user_id=current_user.id,
            status_type="video",
            privacy=privacy,
            content=caption or None,
            media_filename=filename,
            created_at=now,
            expires_at=now + timedelta(hours=24)
        )

        db.session.add(status)
        db.session.flush()

        for user_id in selected_ids:
            db.session.add(
                StatusAllowedViewer(
                    status_id=status.id,
                    user_id=user_id
                )
            )

        db.session.commit()

    except Exception:
        db.session.rollback()
        destination.unlink(missing_ok=True)

        return jsonify({
            "error": "Unable to save Video Status."
        }), 500

    socketio.emit(
        "status_updated",
        {
            "action": "created",
            "status_id": status.id
        }
    )

    return jsonify({
        "message": "Video Status posted successfully.",
        "status": {
            "id": status.id,
            "status_type": status.status_type,
            "privacy": status.privacy,
            "duration": validation["duration"],
            "has_audio": validation["has_audio"],
            "expires_at": status.expires_at.isoformat()
        }
    }), 201


@status_bp.route("/photo", methods=["POST"])
@login_required
def create_photo_status():
    from .models import User

    upload = request.files.get("photo")

    error = validate_status_image(upload)

    if error:
        return jsonify({"error": error}), 400

    # BLACK PILL PHOTO STATUS CAPTION
    caption = request.form.get("content", "").strip()

    if len(caption) > 500:
        return jsonify({
            "error": "Photo Status caption cannot exceed 500 characters."
        }), 400

    privacy = request.form.get("privacy", "contacts")

    if privacy not in ("everyone", "contacts", "selected"):
        return jsonify({"error": "Invalid privacy setting."}), 400

    selected_ids = []

    if privacy == "selected":
        raw_ids = request.form.getlist("selected_user_ids")

        try:
            selected_ids = [int(value) for value in raw_ids]
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid selected users."}), 400

        if (
            not selected_ids
            or len(selected_ids) > 100
            or any(user_id <= 0 for user_id in selected_ids)
            or len(set(selected_ids)) != len(selected_ids)
            or current_user.id in selected_ids
        ):
            return jsonify({"error": "Invalid selected users."}), 400

        existing_ids = {
            user.id
            for user in User.query.filter(User.id.in_(selected_ids)).all()
        }

        if existing_ids != set(selected_ids):
            return jsonify({"error": "One or more users do not exist."}), 400

    elif request.form.getlist("selected_user_ids"):
        return jsonify({"error": "Selected users require selected privacy."}), 400

    extension = Path(upload.filename).suffix.lower()

    filename = f"{uuid.uuid4().hex}{extension}"
    destination = STATUS_IMAGE_FOLDER / filename

    now = datetime.now(timezone.utc)

    try:
        upload.save(destination)

        status = StatusUpdate(
            user_id=current_user.id,
            status_type="photo",
            privacy=privacy,
            content=caption or None,
            media_filename=filename,
            created_at=now,
            expires_at=now + timedelta(hours=24)
        )

        db.session.add(status)
        db.session.flush()

        for user_id in selected_ids:
            db.session.add(
                StatusAllowedViewer(
                    status_id=status.id,
                    user_id=user_id
                )
            )

        db.session.commit()

    except Exception:
        db.session.rollback()
        destination.unlink(missing_ok=True)
        return jsonify({"error": "Unable to save photo status."}), 500

    socketio.emit(
        "status_updated",
        {
            "action": "created",
            "status_id": status.id
        }
    )

    return jsonify({
        "message": "Photo Status posted successfully.",
        "status": {
            "id": status.id,
            "status_type": status.status_type,
            "privacy": status.privacy,
            "media_filename": status.media_filename,
            "expires_at": status.expires_at.isoformat()
        }
    }), 201

@status_bp.route("/text", methods=["POST"])
@login_required
def create_text_status():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON object is required."
        }), 400

    content = data.get("content")

    if not isinstance(content, str):
        return jsonify({
            "error": "Status text is required."
        }), 400

    content = content.strip()

    if not content:
        return jsonify({
            "error": "Status cannot be empty."
        }), 400

    if len(content) > 1000:
        return jsonify({
            "error": "Status cannot exceed 1000 characters."
        }), 400

    privacy = data.get("privacy", "contacts")

    if privacy not in ("everyone", "contacts", "selected"):
        return jsonify({
            "error": "Invalid privacy setting."
        }), 400

    selected_ids = data.get("selected_user_ids", [])

    if privacy == "selected":
        if (
            not isinstance(selected_ids, list)
            or not selected_ids
            or len(selected_ids) > 100
            or any(
                type(user_id) is not int or user_id <= 0
                for user_id in selected_ids
            )
            or len(set(selected_ids)) != len(selected_ids)
            or current_user.id in selected_ids
        ):
            return jsonify({
                "error": "Select 1 to 100 valid, unique users other than yourself."
            }), 400

        from .models import User

        existing_ids = {
            user.id
            for user in User.query.filter(
                User.id.in_(selected_ids)
            ).all()
        }

        if existing_ids != set(selected_ids):
            return jsonify({
                "error": "One or more selected users do not exist."
            }), 400
    elif selected_ids:
        return jsonify({
            "error": "Selected users require selected privacy."
        }), 400

    now = datetime.now(timezone.utc)

    status = StatusUpdate(
        user_id=current_user.id,
        status_type="text",
        privacy=privacy,
        content=content,
        created_at=now,
        expires_at=now + timedelta(hours=24)
    )

    db.session.add(status)
    db.session.flush()

    if privacy == "selected":
        for user_id in selected_ids:
            db.session.add(
                StatusAllowedViewer(
                    status_id=status.id,
                    user_id=user_id
                )
            )

    db.session.commit()

    socketio.emit(
        "status_updated",
        {
            "action": "created",
            "status_id": status.id
        }
    )

    return jsonify({
        "message": "Status posted successfully.",
        "status": {
            "id": status.id,
            "user_id": status.user_id,
            "username": current_user.username,
            "status_type": status.status_type,
            "privacy": status.privacy,
            "selected_user_ids": (
                selected_ids if privacy == "selected" else []
            ),
            "content": status.content,
            "created_at": status.created_at.isoformat(),
            "expires_at": status.expires_at.isoformat()
        }
    }), 201



# BLACK PILL PROTECTED STATUS MEDIA

@status_bp.route("/<int:status_id>/media", methods=["GET"])
@login_required
def get_status_media(status_id):
    from flask import send_from_directory

    now = datetime.now(timezone.utc)

    status = (
        StatusUpdate.query
        .filter(
            StatusUpdate.id == status_id,
            StatusUpdate.expires_at > now,
            StatusUpdate.status_type.in_(("photo", "video", "audio"))
        )
        .first()
    )

    if status is None or not status.media_filename:
        return jsonify({"error": "Status media not found."}), 404

    if status.user_id != current_user.id:
        allowed = False

        if status.privacy == "everyone":
            allowed = True

        elif status.privacy == "contacts":
            allowed = Contact.query.filter_by(
                owner_id=status.user_id,
                contact_user_id=current_user.id
            ).first() is not None

        elif status.privacy == "selected":
            allowed = StatusAllowedViewer.query.filter_by(
                status_id=status.id,
                user_id=current_user.id
            ).first() is not None

        if not allowed:
            return jsonify({"error": "Status media not found."}), 404

    # BLACK PILL PHOTO AND VIDEO MEDIA SUPPORT
    if status.status_type == "photo":
        media_folder = STATUS_IMAGE_FOLDER
    elif status.status_type == "video":
        media_folder = STATUS_VIDEO_FOLDER
    elif status.status_type == "audio":
        media_folder = STATUS_AUDIO_FOLDER
    else:
        return jsonify({"error": "Unsupported media type."}), 404

    response = send_from_directory(
        media_folder,
        status.media_filename,
        as_attachment=False,
        conditional=True,
        max_age=0
    )

    # Prevent private Status media from being cached.
    response.headers["Cache-Control"] = "private, no-store"

    return response

@status_bp.route("/feed", methods=["GET"])
@login_required
def get_status_feed():
    now = datetime.now(timezone.utc)

    statuses = (
        StatusUpdate.query
        .filter(StatusUpdate.expires_at > now)
        .filter(
            or_(
                StatusUpdate.user_id == current_user.id,
                StatusUpdate.privacy == "everyone",
                and_(
                    StatusUpdate.privacy == "contacts",
                    db.session.query(Contact.id)
                    .filter(
                        Contact.owner_id == StatusUpdate.user_id,
                        Contact.contact_user_id == current_user.id
                    )
                    .exists()
                ),
                and_(
                    StatusUpdate.privacy == "selected",
                    db.session.query(StatusAllowedViewer.id)
                    .filter(
                        StatusAllowedViewer.status_id == StatusUpdate.id,
                        StatusAllowedViewer.user_id == current_user.id
                    )
                    .exists()
                )
            )
        )
        .order_by(
            StatusUpdate.created_at.desc(),
            StatusUpdate.id.desc()
        )
        .limit(100)
        .all()
    )

    return jsonify({
        "statuses": [
            {
                "id": status.id,
                "user_id": status.user_id,
                "username": status.user.username,
                "status_type": status.status_type,
                "media_url": (
                    f"/status/{status.id}/media"
                    if status.media_filename else None
                ),
                "content": status.content,
                "created_at": status.created_at.isoformat(),
                "expires_at": status.expires_at.isoformat()
            }
            for status in statuses
        ]
    }), 200


@status_bp.route("/<int:status_id>", methods=["DELETE"])
@login_required
def delete_status(status_id):
    status = db.session.get(StatusUpdate, status_id)

    if status is None:
        return jsonify({
            "error": "Status not found."
        }), 404

    if status.user_id != current_user.id:
        return jsonify({
            "error": "You can only delete your own statuses."
        }), 403

    db.session.delete(status)
    db.session.commit()

    socketio.emit(
        "status_updated",
        {
            "action": "deleted",
            "status_id": status_id
        }
    )

    return jsonify({
        "message": "Status deleted successfully.",
        "status_id": status_id
    }), 200


@status_bp.route("/<int:status_id>/view", methods=["POST"])
@login_required
def view_status(status_id):
    from sqlalchemy.exc import IntegrityError
    from .models import StatusView

    now = datetime.now(timezone.utc)

    status = (
        StatusUpdate.query
        .filter(
            StatusUpdate.id == status_id,
            StatusUpdate.expires_at > now
        )
        .first()
    )

    if status is None:
        return jsonify({
            "error": "Status not found or expired."
        }), 404

    # Enforce privacy before returning status content.
    if status.user_id != current_user.id:
        allowed = False

        if status.privacy == "everyone":
            allowed = True

        elif status.privacy == "contacts":
            allowed = Contact.query.filter_by(
                owner_id=status.user_id,
                contact_user_id=current_user.id
            ).first() is not None

        elif status.privacy == "selected":
            allowed = StatusAllowedViewer.query.filter_by(
                status_id=status.id,
                user_id=current_user.id
            ).first() is not None

        if not allowed:
            return jsonify({
                "error": "Status not found."
            }), 404

        existing_view = StatusView.query.filter_by(
            status_id=status.id,
            viewer_id=current_user.id
        ).first()

        if existing_view is None:
            db.session.add(
                StatusView(
                    status_id=status.id,
                    viewer_id=current_user.id
                )
            )

            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()

    return jsonify({
        "status": {
            "id": status.id,
            "user_id": status.user_id,
            "username": status.user.username,
            "status_type": status.status_type,
            "content": status.content,
            "created_at": status.created_at.isoformat(),
            "expires_at": status.expires_at.isoformat()
        }
    }), 200


@status_bp.route("/<int:status_id>/viewers", methods=["GET"])
@login_required
def get_status_viewers(status_id):
    from .models import StatusView

    status = db.session.get(StatusUpdate, status_id)

    if status is None:
        return jsonify({"error": "Status not found."}), 404

    if status.user_id != current_user.id:
        return jsonify({"error": "Access denied."}), 403

    views = (
        StatusView.query
        .filter_by(status_id=status.id)
        .order_by(StatusView.viewed_at.desc())
        .all()
    )

    return jsonify({
        "status_id": status.id,
        "total_views": len(views),
        "viewers": [
            {
                "user_id": view.viewer_id,
                "username": view.viewer.username,
                "viewed_at": view.viewed_at.isoformat()
            }
            for view in views
        ]
    }), 200
