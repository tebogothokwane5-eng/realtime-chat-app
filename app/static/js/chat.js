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

        const emailElement = document.createElement("div");
        emailElement.className = "user-item-email";
        emailElement.textContent = user.email;

        const statusElement = document.createElement("div");
        statusElement.className = "user-item-status";
        statusElement.dataset.statusUserId = user.id;

        userElement.appendChild(nameRow);
        userElement.appendChild(emailElement);
        userElement.appendChild(statusElement);

        updateUserStatus(user.id);

        userElement.addEventListener("click", () => {
            selectUser(user, userElement);
        });

        usersListElement.appendChild(userElement);
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

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    bubble.appendChild(content);
    bubble.appendChild(time);
    row.appendChild(bubble);

    messagesElement.appendChild(row);

    scrollToBottom();
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


messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!selectedUser) {
        return;
    }

    const content = messageInput.value.trim();

    if (!content) {
        return;
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


socket.on("message_sent", (message) => {
    if (
        selectedUser &&
        message.receiver_id === selectedUser.id
    ) {
        renderMessage(message);
    }
});


socket.on("new_message", (message) => {
    if (
        selectedUser &&
        Number(message.sender_id) === Number(selectedUser.id)
    ) {
        renderMessage(message);
        return;
    }

    incrementUnread(message.sender_id);
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
