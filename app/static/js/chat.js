const currentUserElement = document.getElementById("current-user");
const usersListElement = document.getElementById("users-list");
const conversationNameElement = document.getElementById("conversation-name");
const conversationStatusElement = document.getElementById("conversation-status");
const messagesElement = document.getElementById("messages");

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const emojiButton = document.getElementById("emoji-button");
const emojiPicker = document.getElementById("emoji-picker");
const imageButton = document.getElementById("image-button");
const imageInput = document.getElementById("image-input");

const imageViewer = document.getElementById("image-viewer");
const imageViewerImage =
    document.getElementById("image-viewer-image");
const imageViewerName =
    document.getElementById("image-viewer-name");
const imageViewerClose =
    document.getElementById("image-viewer-close");

const logoutButton = document.getElementById("logout-button");

const replyPreviewElement =
    document.getElementById("reply-preview");
const replyPreviewNameElement =
    document.getElementById("reply-preview-name");
const replyPreviewContentElement =
    document.getElementById("reply-preview-content");
const cancelReplyButton =
    document.getElementById("cancel-reply-button");

let currentUser = null;
let selectedUser = null;
let onlineUserIds = new Set();
let unreadCounts = new Map();
let typingTimeout = null;
let typingSent = false;
let replyingToMessage = null;

const socket = io();


async function loadCurrentUser() {
    const response = await fetch("/auth/me");

    if (!response.ok) {
        window.location.href = "/login";
        return false;
    }

    const data = await response.json();
    currentUser = data.user;

    currentUserElement.textContent = `@${currentUser.username}`;

    return true;
}


async function loadUsers() {
    const response = await fetch("/chat/users");

    if (!response.ok) {
        usersListElement.innerHTML =
            '<p class="empty-text">Could not load users.</p>';
        return;
    }

    const data = await response.json();

    usersListElement.innerHTML = "";

    if (data.users.length === 0) {
        usersListElement.innerHTML =
            '<p class="empty-text">No other users yet.</p>';
        return;
    }

    data.users.forEach((user) => {
        const unreadCount = Number(user.unread_count) || 0;

        if (unreadCount > 0) {
            unreadCounts.set(Number(user.id), unreadCount);
        } else {
            unreadCounts.delete(Number(user.id));
        }

        const userElement = document.createElement("div");

        userElement.className = "user-item";
        userElement.dataset.userId = user.id;

        const nameRow = document.createElement("div");
        nameRow.className = "user-item-name-row";

        const nameElement = document.createElement("div");
        nameElement.className = "user-item-name";
        nameElement.textContent = user.username;

        const unreadBadge = document.createElement("span");
        unreadBadge.className = "unread-badge";
        unreadBadge.dataset.unreadUserId = user.id;
        unreadBadge.hidden = true;

        nameRow.appendChild(nameElement);
        nameRow.appendChild(unreadBadge);

        const previewRow = document.createElement("div");
        previewRow.className = "user-preview-row";

        const previewElement = document.createElement("div");
        previewElement.className = "user-message-preview";
        previewElement.dataset.previewUserId = user.id;

        if (user.last_message) {
            const prefix =
                Number(user.last_message_sender_id) === Number(currentUser.id)
                    ? "You: "
                    : "";

            previewElement.textContent =
                `${prefix}${user.last_message}`;
        } else {
            previewElement.textContent = "No messages yet";
        }

        const timeElement = document.createElement("span");
        timeElement.className = "user-message-time";
        timeElement.dataset.previewTimeUserId = user.id;

        if (user.last_message_at) {
            timeElement.textContent =
                formatSidebarTime(user.last_message_at);
        }

        previewRow.appendChild(previewElement);
        previewRow.appendChild(timeElement);

        const statusElement = document.createElement("div");
        statusElement.className = "user-item-status";
        statusElement.dataset.statusUserId = user.id;

        userElement.appendChild(nameRow);
        userElement.appendChild(previewRow);
        userElement.appendChild(statusElement);

        updateUserStatus(user.id);

        userElement.addEventListener("click", () => {
            selectUser(user, userElement);
        });

        usersListElement.appendChild(userElement);
        updateUnreadBadge(user.id);
    });
}


async function selectUser(user, userElement) {
    cancelReply();
    selectedUser = user;

    clearUnread(user.id);

    document.querySelectorAll(".user-item").forEach((element) => {
        element.classList.remove("active");
    });

    userElement.classList.add("active");

    conversationNameElement.textContent = user.username;
    updateConversationStatus();

    messageInput.disabled = false;
    sendButton.disabled = false;
    emojiButton.disabled = false;
    imageButton.disabled = false;

    messageInput.focus();

    await loadConversation(user.id);

    markConversationRead(user.id);
}


async function loadConversation(userId) {
    messagesElement.innerHTML =
        '<p class="empty-text">Loading conversation...</p>';

    const response = await fetch(`/chat/conversation/${userId}`);

    if (!response.ok) {
        messagesElement.innerHTML =
            '<p class="empty-text">Could not load conversation.</p>';
        return;
    }

    const data = await response.json();

    messagesElement.innerHTML = "";

    if (data.messages.length === 0) {
        messagesElement.innerHTML =
            '<p class="empty-text">No messages yet. Say hello!</p>';
        return;
    }

    data.messages.forEach((message) => {
        renderMessage(message);
    });

    scrollToBottom();
}


function renderMessageReactions(messageId, reactions = []) {
    const row = document.querySelector(
        `[data-message-id="${messageId}"]`
    );

    if (!row) {
        return;
    }

    let container = row.querySelector(".message-reactions");

    if (!container) {
        container = document.createElement("div");
        container.className = "message-reactions";

        const bubble = row.querySelector(".message-bubble");

        if (!bubble) {
            return;
        }

        bubble.appendChild(container);
    }

    container.innerHTML = "";

    if (!reactions.length) {
        container.hidden = true;
        return;
    }

    const grouped = new Map();

    reactions.forEach((reaction) => {
        const emoji = reaction.emoji;

        if (!grouped.has(emoji)) {
            grouped.set(emoji, {
                count: 0,
                users: [],
                reactedByCurrentUser: false
            });
        }

        const group = grouped.get(emoji);

        group.count += 1;
        group.users.push(reaction.username);

        if (
            Number(reaction.user_id) ===
            Number(currentUser.id)
        ) {
            group.reactedByCurrentUser = true;
        }
    });

    grouped.forEach((group, emoji) => {
        const chip = document.createElement("button");

        chip.type = "button";
        chip.className = "message-reaction-chip";

        if (group.reactedByCurrentUser) {
            chip.classList.add("mine");
        }

        chip.textContent =
            group.count > 1
                ? `${emoji} ${group.count}`
                : emoji;

        chip.title = group.users.join(", ");

        chip.addEventListener("click", () => {
            reactToMessage(messageId, emoji);
        });

        container.appendChild(chip);
    });

    container.hidden = false;
}


function renderMessage(message) {
    const existingMessage =
        document.querySelector(`[data-message-id="${message.id}"]`);

    if (existingMessage) {
        return;
    }

    const emptyMessage = messagesElement.querySelector(".empty-text");

    if (emptyMessage) {
        emptyMessage.remove();
    }

    const row = document.createElement("div");

    row.className =
        message.sender_id === currentUser.id
            ? "message-row sent"
            : "message-row received";

    row.dataset.messageId = message.id;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (message.reply_to) {
        const replyQuote = document.createElement("div");
        replyQuote.className = "message-reply-quote";

        const replyName = document.createElement("div");
        replyName.className = "message-reply-name";

        const replyIsCurrentUser =
            Number(message.reply_to.sender_id) ===
            Number(currentUser.id);

        replyName.textContent = replyIsCurrentUser
            ? "You"
            : message.reply_to.sender_username;

        const replyContent = document.createElement("div");
        replyContent.className = "message-reply-content";

        replyContent.textContent = message.reply_to.deleted
            ? "Original message deleted"
            : message.reply_to.content;

        if (message.reply_to.deleted) {
            replyQuote.classList.add("deleted-reply");
        }

        replyQuote.dataset.replyToMessageId =
            message.reply_to.id;

        replyQuote.appendChild(replyName);
        replyQuote.appendChild(replyContent);
        bubble.appendChild(replyQuote);
    }

    const content = document.createElement("div");
    content.className = "message-content";
    content.dataset.contentMessageId = message.id;

    if (
        message.message_type === "image"
        && message.image_url
    ) {
        content.classList.add("image-message-content");

        const image = document.createElement("img");
        image.className = "chat-message-image";
        image.src = message.image_url;
        image.alt =
            message.image_original_name || "Shared image";
        image.loading = "lazy";

        image.addEventListener("click", () => {
            imageViewerImage.src = message.image_url;
            imageViewerImage.alt =
                message.image_original_name || "Shared image";

            imageViewerName.textContent =
                message.image_original_name || "";

            imageViewer.hidden = false;
            imageViewer.setAttribute(
                "aria-hidden",
                "false"
            );

            document.body.classList.add(
                "image-viewer-open"
            );
        });

        content.appendChild(image);

        if (message.image_original_name) {
            const imageName = document.createElement("div");
            imageName.className = "chat-image-name";
            imageName.textContent =
                message.image_original_name;

            content.appendChild(imageName);
        }
    } else {
        content.textContent = message.content;
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    meta.appendChild(time);

    if (message.edited_at) {
        const edited = document.createElement("span");
        edited.className = "message-edited";
        edited.dataset.editedMessageId = message.id;
        edited.textContent = "Edited";
        meta.appendChild(edited);
    }

    if (Number(message.sender_id) === Number(currentUser.id)) {
        const receipt = document.createElement("span");
        receipt.className = "message-receipt";
        receipt.dataset.receiptMessageId = message.id;

        if (message.read_at) {
            receipt.textContent = "✓✓ Read";
            receipt.classList.add("read");
        } else {
            receipt.textContent = "✓ Sent";
        }

        meta.appendChild(receipt);
    }

    bubble.appendChild(content);
    bubble.appendChild(meta);
    row.appendChild(bubble);

    bubble.addEventListener("contextmenu", (event) => {
        event.preventDefault();

        showMessageContextMenu(
            message,
            event.clientX,
            event.clientY
        );
    });

    let longPressTimer = null;

    const cancelLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    bubble.addEventListener("touchstart", (event) => {
        const touch = event.touches[0];

        if (!touch) {
            return;
        }

        const x = touch.clientX;
        const y = touch.clientY;

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            showMessageContextMenu(message, x, y);
        }, 600);
    }, { passive: true });

    bubble.addEventListener("touchend", cancelLongPress);
    bubble.addEventListener("touchcancel", cancelLongPress);
    bubble.addEventListener("touchmove", cancelLongPress);

    messagesElement.appendChild(row);

    renderMessageReactions(
        message.id,
        message.reactions || []
    );

    scrollToBottom();
}


function startReply(message) {
    replyingToMessage = message;

    const isOwnMessage =
        Number(message.sender_id) === Number(currentUser.id);

    replyPreviewNameElement.textContent =
        isOwnMessage
            ? "Replying to yourself"
            : `Replying to ${selectedUser.username}`;

    replyPreviewContentElement.textContent =
        message.content;

    replyPreviewElement.hidden = false;

    messageInput.focus();
}


function cancelReply() {
    replyingToMessage = null;

    replyPreviewNameElement.textContent = "";
    replyPreviewContentElement.textContent = "";
    replyPreviewElement.hidden = true;
}


cancelReplyButton.addEventListener("click", () => {
    cancelReply();
    messageInput.focus();
});


function closeMessageContextMenu() {
    const existingMenu = document.querySelector(
        ".message-context-menu"
    );

    if (existingMenu) {
        existingMenu.remove();
    }
}


function reactToMessage(messageId, emoji) {
    socket.emit("react_message", {
        message_id: messageId,
        emoji: emoji
    });
}


function showMessageContextMenu(message, x, y) {
    closeMessageContextMenu();

    const menu = document.createElement("div");
    menu.className = "message-context-menu";

    const reactionPicker = document.createElement("div");
    reactionPicker.className = "message-reaction-picker";

    ["👍", "❤️", "😂", "😮", "😢", "🔥"].forEach((emoji) => {
        const reactionButton = document.createElement("button");

        reactionButton.type = "button";
        reactionButton.className = "message-reaction-option";
        reactionButton.textContent = emoji;
        reactionButton.title = `React with ${emoji}`;

        reactionButton.addEventListener("click", () => {
            reactToMessage(message.id, emoji);
            closeMessageContextMenu();
        });

        reactionPicker.appendChild(reactionButton);
    });

    menu.appendChild(reactionPicker);

    const replyMessage = document.createElement("button");
    replyMessage.type = "button";
    replyMessage.textContent = "Reply";

    replyMessage.addEventListener("click", () => {
        startReply(message);
        closeMessageContextMenu();
    });

    menu.appendChild(replyMessage);

    const deleteForMe = document.createElement("button");
    deleteForMe.type = "button";
    deleteForMe.textContent = "Delete for me";

    deleteForMe.addEventListener("click", () => {
        socket.emit("delete_message", {
            message_id: message.id,
            delete_type: "me"
        });

        closeMessageContextMenu();
    });

    menu.appendChild(deleteForMe);

    const isSender =
        Number(message.sender_id) === Number(currentUser.id);

    if (isSender) {
        if (message.message_type !== "image") {
            const editMessage =
                document.createElement("button");

            editMessage.type = "button";
            editMessage.textContent = "Edit";

            editMessage.addEventListener("click", () => {
                closeMessageContextMenu();

                const newContent = window.prompt(
                    "Edit message:",
                    message.content
                );

                if (newContent === null) {
                    return;
                }

                const trimmedContent =
                    newContent.trim();

                if (!trimmedContent) {
                    window.alert(
                        "Message cannot be empty."
                    );
                    return;
                }

                if (
                    trimmedContent === message.content
                ) {
                    return;
                }

                socket.emit("edit_message", {
                    message_id: message.id,
                    content: trimmedContent
                });
            });

            menu.appendChild(editMessage);
        }

        const deleteForEveryone =
            document.createElement("button");

        deleteForEveryone.type = "button";
        deleteForEveryone.textContent =
            "Delete for everyone";
        deleteForEveryone.className =
            "delete-for-everyone";

        deleteForEveryone.addEventListener("click", () => {
            socket.emit("delete_message", {
                message_id: message.id,
                delete_type: "everyone"
            });

            closeMessageContextMenu();
        });

        menu.appendChild(deleteForEveryone);
    }

    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();

    const left = Math.min(
        x,
        window.innerWidth - menuRect.width - 8
    );

    const top = Math.min(
        y,
        window.innerHeight - menuRect.height - 8
    );

    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}


document.addEventListener("click", (event) => {
    if (!event.target.closest(".message-context-menu")) {
        closeMessageContextMenu();
    }
});


window.addEventListener("resize", closeMessageContextMenu);
window.addEventListener("scroll", closeMessageContextMenu, true);


function markConversationRead(userId) {
    if (!userId) {
        return;
    }

    if (!socket.connected) {
        return;
    }

    socket.emit("mark_read", {
        sender_id: Number(userId)
    });
}


function updateReadReceipts(messageIds) {
    (messageIds || []).forEach((messageId) => {
        const receipt = document.querySelector(
            `[data-receipt-message-id="${messageId}"]`
        );

        if (!receipt) {
            return;
        }

        receipt.textContent = "✓✓ Read";
        receipt.classList.add("read");
    });
}


function updateConversationPreview(message) {
    if (!currentUser || !message) {
        return;
    }

    const isOutgoing =
        Number(message.sender_id) === Number(currentUser.id);

    const otherUserId = isOutgoing
        ? Number(message.receiver_id)
        : Number(message.sender_id);

    const previewElement = document.querySelector(
        `[data-preview-user-id="${otherUserId}"]`
    );

    const timeElement = document.querySelector(
        `[data-preview-time-user-id="${otherUserId}"]`
    );

    if (previewElement) {
        const prefix = isOutgoing ? "You: " : "";
        previewElement.textContent =
            `${prefix}${message.content}`;
    }

    if (timeElement && message.created_at) {
        timeElement.textContent =
            formatSidebarTime(message.created_at);
    }
}


function formatSidebarTime(timestamp) {
    const date = new Date(timestamp);

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}


function formatTime(timestamp) {
    const date = new Date(timestamp);

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}


function scrollToBottom() {
    messagesElement.scrollTop = messagesElement.scrollHeight;
}


function incrementUnread(userId) {
    userId = Number(userId);

    const count = (unreadCounts.get(userId) || 0) + 1;
    unreadCounts.set(userId, count);

    updateUnreadBadge(userId);
}


function clearUnread(userId) {
    userId = Number(userId);

    unreadCounts.delete(userId);
    updateUnreadBadge(userId);
}


function updateUnreadBadge(userId) {
    const badge = document.querySelector(
        `[data-unread-user-id="${userId}"]`
    );

    if (!badge) {
        return;
    }

    const count = unreadCounts.get(Number(userId)) || 0;

    if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
    } else {
        badge.textContent = "";
        badge.hidden = true;
    }
}


function updateUserStatus(userId) {
    const statusElement = document.querySelector(
        `[data-status-user-id="${userId}"]`
    );

    if (!statusElement) {
        return;
    }

    if (onlineUserIds.has(Number(userId))) {
        statusElement.textContent = "● Online";
        statusElement.classList.add("online");
    } else {
        statusElement.textContent = "○ Offline";
        statusElement.classList.remove("online");
    }
}


function updateConversationStatus() {
    if (!selectedUser) {
        return;
    }

    if (onlineUserIds.has(Number(selectedUser.id))) {
        conversationStatusElement.textContent = "● Online";
        conversationStatusElement.classList.add("online");
    } else {
        conversationStatusElement.textContent = "○ Offline";
        conversationStatusElement.classList.remove("online");
    }
}


function refreshPresenceDisplay() {
    document.querySelectorAll("[data-status-user-id]").forEach((element) => {
        updateUserStatus(Number(element.dataset.statusUserId));
    });

    updateConversationStatus();
}


function closeEmojiPicker() {
    emojiPicker.hidden = true;
}


emojiButton.addEventListener("click", (event) => {
    event.stopPropagation();

    if (emojiButton.disabled) {
        return;
    }

    emojiPicker.hidden = !emojiPicker.hidden;
});


emojiPicker.addEventListener("click", (event) => {
    const emojiOption = event.target.closest("[data-emoji]");

    if (!emojiOption) {
        return;
    }

    const emoji = emojiOption.dataset.emoji;

    const start =
        messageInput.selectionStart ?? messageInput.value.length;

    const end =
        messageInput.selectionEnd ?? start;

    messageInput.setRangeText(
        emoji,
        start,
        end,
        "end"
    );

    messageInput.dispatchEvent(
        new Event("input", {
            bubbles: true
        })
    );

    closeEmojiPicker();
    messageInput.focus();
});


document.addEventListener("click", (event) => {
    if (!event.target.closest(".emoji-picker-wrapper")) {
        closeEmojiPicker();
    }
});


imageButton.addEventListener("click", () => {
    if (!selectedUser || imageButton.disabled) {
        return;
    }

    imageInput.click();
});


imageInput.addEventListener("change", async () => {
    const imageFile = imageInput.files[0];

    if (!imageFile) {
        return;
    }

    if (!selectedUser) {
        imageInput.value = "";
        return;
    }

    const allowedTypes = new Set([
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp"
    ]);

    if (!allowedTypes.has(imageFile.type)) {
        alert(
            "Unsupported image type. " +
            "Use PNG, JPG, JPEG, GIF, or WebP."
        );

        imageInput.value = "";
        return;
    }

    const maxImageSize = 10 * 1024 * 1024;

    if (imageFile.size > maxImageSize) {
        alert("Image must be 10 MB or smaller.");
        imageInput.value = "";
        return;
    }

    const receiverId = selectedUser.id;
    const formData = new FormData();

    formData.append("receiver_id", receiverId);
    formData.append("image", imageFile);

    imageButton.disabled = true;

    try {
        const response = await fetch("/chat/send-image", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not send image."
            );
        }

        if (
            selectedUser
            && Number(selectedUser.id) === Number(receiverId)
            && data.data
        ) {
            renderMessage(data.data);
        }
    } catch (error) {
        console.error("Image upload failed:", error);
        alert(error.message || "Could not send image.");
    } finally {
        imageInput.value = "";

        if (selectedUser) {
            imageButton.disabled = false;
        }
    }
});


function sendTypingStatus(isTyping) {
    console.log("Sending typing event:", isTyping, "to:", selectedUser?.id);
    if (!selectedUser || !socket.connected) {
        return;
    }

    socket.emit("typing", {
        receiver_id: selectedUser.id,
        is_typing: isTyping
    });
}


messageInput.addEventListener("input", () => {
    if (!selectedUser) {
        return;
    }

    const hasText = messageInput.value.trim().length > 0;

    if (hasText && !typingSent) {
        typingSent = true;
        sendTypingStatus(true);
    }

    clearTimeout(typingTimeout);

    if (!hasText) {
        if (typingSent) {
            typingSent = false;
            sendTypingStatus(false);
        }

        return;
    }

    typingTimeout = setTimeout(() => {
        if (typingSent) {
            typingSent = false;
            sendTypingStatus(false);
        }
    }, 3000);
});


messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!selectedUser) {
        return;
    }

    const content = messageInput.value.trim();

    if (!content) {
        return;
    }

    if (typingSent) {
        typingSent = false;
        clearTimeout(typingTimeout);
        sendTypingStatus(false);
    }

    socket.emit("send_message", {
        receiver_id: selectedUser.id,
        content: content,
        reply_to_message_id: replyingToMessage
            ? replyingToMessage.id
            : null
    });

    messageInput.value = "";
    cancelReply();
    messageInput.focus();
});


socket.on("connect", () => {
    console.log("Socket.IO connected.");

    // If a conversation was already opened before Socket.IO connected,
    // mark its incoming messages as read now.
    if (selectedUser) {
        markConversationRead(selectedUser.id);
    }
});


socket.on("online_users", (data) => {
    onlineUserIds = new Set(
        (data.user_ids || []).map(Number)
    );

    refreshPresenceDisplay();
});


socket.on("user_status", (data) => {
    const userId = Number(data.user_id);

    if (data.status === "online") {
        onlineUserIds.add(userId);
    } else {
        onlineUserIds.delete(userId);
    }

    updateUserStatus(userId);

    if (
        selectedUser &&
        Number(selectedUser.id) === userId
    ) {
        updateConversationStatus();
    }
});


socket.on("typing_status", (data) => {
    console.log("Received typing status:", data);
    if (
        !selectedUser ||
        Number(data.user_id) !== Number(selectedUser.id)
    ) {
        return;
    }

    if (data.is_typing) {
        conversationStatusElement.textContent =
            `${data.username} is typing...`;

        conversationStatusElement.classList.remove("online");
    } else {
        updateConversationStatus();
    }
});


socket.on("message_sent", (message) => {
    updateConversationPreview(message);

    if (
        selectedUser &&
        message.receiver_id === selectedUser.id
    ) {
        renderMessage(message);
    }
});


socket.on("new_message", (message) => {
    updateConversationPreview(message);

    if (
        selectedUser &&
        Number(message.sender_id) === Number(selectedUser.id)
    ) {
        renderMessage(message);
        markConversationRead(message.sender_id);
        return;
    }

    incrementUnread(message.sender_id);
});


socket.on("messages_read", (data) => {
    updateReadReceipts(data.message_ids);
});


socket.on("message_reaction", (data) => {
    renderMessageReactions(
        data.message_id,
        data.reactions || []
    );
});


socket.on("reaction_error", (data) => {
    window.alert(
        data.error || "Could not react to the message."
    );
});


socket.on("message_edited", (data) => {
    const content = document.querySelector(
        `[data-content-message-id="${data.message_id}"]`
    );

    if (content) {
        content.textContent = data.content;

        const row = content.closest(".message-row");
        const meta = row?.querySelector(".message-meta");

        if (
            meta &&
            !meta.querySelector(
                `[data-edited-message-id="${data.message_id}"]`
            )
        ) {
            const edited = document.createElement("span");
            edited.className = "message-edited";
            edited.dataset.editedMessageId = data.message_id;
            edited.textContent = "Edited";

            const receipt = meta.querySelector(".message-receipt");

            if (receipt) {
                meta.insertBefore(edited, receipt);
            } else {
                meta.appendChild(edited);
            }
        }
    }

    const replyQuotes = document.querySelectorAll(
        `[data-reply-to-message-id="${data.message_id}"]`
    );

    replyQuotes.forEach((replyQuote) => {
        if (replyQuote.classList.contains("deleted-reply")) {
            return;
        }

        const replyContent = replyQuote.querySelector(
            ".message-reply-content"
        );

        if (replyContent) {
            replyContent.textContent = data.content;
        }
    });

    // Refresh the latest conversation preview.
    loadUsers();
});


socket.on("edit_message_error", (data) => {
    window.alert(
        data.error || "Could not edit the message."
    );
});


socket.on("message_deleted", (data) => {
    const messageElement = document.querySelector(
        `[data-message-id="${data.message_id}"]`
    );

    if (messageElement) {
        messageElement.remove();
    }

    const replyQuotes = document.querySelectorAll(
        `[data-reply-to-message-id="${data.message_id}"]`
    );

    replyQuotes.forEach((replyQuote) => {
        const replyContent = replyQuote.querySelector(
            ".message-reply-content"
        );

        if (replyContent) {
            replyContent.textContent =
                "Original message deleted";
        }

        replyQuote.classList.add("deleted-reply");
    });

    if (messagesElement.children.length === 0) {
        messagesElement.innerHTML =
            '<p class="empty-text">No messages yet.</p>';
    }

    // Refresh sidebar previews and persistent unread counts.
    loadUsers();
});


socket.on("delete_message_error", (data) => {
    window.alert(
        data.error || "Could not delete the message."
    );
});


socket.on("error", (data) => {
    console.error("Socket error:", data);

    alert(data.error || "A chat error occurred.");
});


logoutButton.addEventListener("click", async () => {
    try {
        await fetch("/auth/logout", {
            method: "POST"
        });
    } finally {
        socket.disconnect();
        window.location.href = "/login";
    }
});


async function initializeChat() {
    try {
        const authenticated = await loadCurrentUser();

        if (!authenticated) {
            return;
        }

        await loadUsers();

    } catch (error) {
        console.error("Chat initialization error:", error);

        window.location.href = "/login";
    }
}


initializeChat();


function closeImageViewer() {
    imageViewer.hidden = true;
    imageViewer.setAttribute("aria-hidden", "true");

    imageViewerImage.src = "";
    imageViewerName.textContent = "";

    document.body.classList.remove(
        "image-viewer-open"
    );
}


imageViewerClose.addEventListener("click", () => {
    closeImageViewer();
});


imageViewer.addEventListener("click", (event) => {
    if (event.target === imageViewer) {
        closeImageViewer();
    }
});


document.addEventListener("keydown", (event) => {
    if (
        event.key === "Escape"
        && !imageViewer.hidden
    ) {
        closeImageViewer();
    }
});
