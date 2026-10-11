from datetime import datetime, timezone

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

from .extensions import db


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(
        db.String(80),
        unique=True,
        nullable=False,
        index=True
    )

    email = db.Column(
        db.String(255),
        unique=True,
        nullable=False,
        index=True
    )

    password_hash = db.Column(
        db.String(255),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f"<User {self.username}>"


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.Integer, primary_key=True)

    sender_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    receiver_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    content = db.Column(
        db.Text,
        nullable=False
    )

    message_type = db.Column(
        db.String(20),
        nullable=False,
        default="text",
        server_default="text"
    )

    image_filename = db.Column(
        db.String(255),
        nullable=True
    )

    image_original_name = db.Column(
        db.String(255),
        nullable=True
    )

    audio_filename = db.Column(
        db.String(255),
        nullable=True
    )

    audio_original_name = db.Column(
        db.String(255),
        nullable=True
    )

    audio_duration_ms = db.Column(
        db.Integer,
        nullable=True
    )

    video_filename = db.Column(
        db.String(255),
        nullable=True
    )

    video_original_name = db.Column(
        db.String(255),
        nullable=True
    )

    reply_to_message_id = db.Column(
        db.Integer,
        db.ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True
    )

    read_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    edited_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    deleted_for_sender_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    deleted_for_receiver_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    deleted_for_everyone_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    sender = db.relationship(
        "User",
        foreign_keys=[sender_id],
        backref="sent_messages"
    )

    receiver = db.relationship(
        "User",
        foreign_keys=[receiver_id],
        backref="received_messages"
    )

    reply_to_message = db.relationship(
        "Message",
        remote_side=[id],
        foreign_keys=[reply_to_message_id]
    )

    def __repr__(self):
        return f"<Message {self.id}: {self.sender_id} -> {self.receiver_id}>"


class MessageReaction(db.Model):
    __tablename__ = "message_reactions"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    message_id = db.Column(
        db.Integer,
        db.ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    emoji = db.Column(
        db.String(32),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    message = db.relationship(
        "Message",
        backref=db.backref(
            "reactions",
            cascade="all, delete-orphan"
        )
    )

    user = db.relationship(
        "User",
        backref="message_reactions"
    )

    __table_args__ = (
        db.UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_reaction_user"
        ),
    )

    def __repr__(self):
        return (
            f"<MessageReaction {self.id}: "
            f"message={self.message_id}, "
            f"user={self.user_id}, "
            f"emoji={self.emoji}>"
        )

class ChatGroup(db.Model):
    __tablename__ = "chat_groups"

    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(
        db.String(100),
        nullable=False
    )

    created_by = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    creator = db.relationship(
        "User",
        backref="created_groups"
    )

    def __repr__(self):
        return f"<ChatGroup {self.id}: {self.name}>"


class GroupMember(db.Model):
    __tablename__ = "group_members"

    id = db.Column(db.Integer, primary_key=True)

    group_id = db.Column(
        db.Integer,
        db.ForeignKey("chat_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    role = db.Column(
        db.String(20),
        nullable=False,
        default="member"
    )

    joined_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    group = db.relationship(
        "ChatGroup",
        backref=db.backref(
            "members",
            cascade="all, delete-orphan"
        )
    )

    user = db.relationship(
        "User",
        backref="group_memberships"
    )

    __table_args__ = (
        db.UniqueConstraint(
            "group_id",
            "user_id",
            name="uq_group_member"
        ),
    )


class GroupMessage(db.Model):
    __tablename__ = "group_messages"

    id = db.Column(db.Integer, primary_key=True)

    group_id = db.Column(
        db.Integer,
        db.ForeignKey("chat_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    sender_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    content = db.Column(
        db.Text,
        nullable=False
    )

    message_type = db.Column(
        db.String(20),
        nullable=False,
        default="text"
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    group = db.relationship(
        "ChatGroup",
        backref=db.backref(
            "messages",
            cascade="all, delete-orphan"
        )
    )

    sender = db.relationship(
        "User",
        backref="group_messages"
    )

