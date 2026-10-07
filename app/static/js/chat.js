const currentUserElement = document.getElementById("current-user");
const usersListElement = document.getElementById("users-list");
const conversationNameElement = document.getElementById("conversation-name");
const conversationStatusElement = document.getElementById("conversation-status");
const messagesElement = document.getElementById("messages");

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const logoutButton = document.getElementById("logout-button");

let currentUser = null;
let selectedUser = null;
let onlineUserIds = new Set();
let unreadCounts = new Map();
let typingTimeout = null;
let typingSent = false;

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

    const content = document.createElement("div");
    content.textContent = message.content;

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    meta.appendChild(time);

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

    scrollToBottom();
}


function closeMessageContextMenu() {
    const existingMenu = document.querySelector(
        ".message-context-menu"
    );

    if (existingMenu) {
        existingMenu.remove();
    }
}


function showMessageContextMenu(message, x, y) {
    closeMessageContextMenu();

    const menu = document.createElement("div");
    menu.className = "message-context-menu";

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
        content: content
    });

    messageInput.value = "";
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


socket.on("message_deleted", (data) => {
    const messageElement = document.querySelector(
        `[data-message-id="${data.message_id}"]`
    );

    if (messageElement) {
        messageElement.remove();
    }

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
