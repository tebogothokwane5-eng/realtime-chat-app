
document.addEventListener("DOMContentLoaded", () => {
    const app = document.querySelector(".chat-app");
    const sidebar = document.getElementById("chat-sidebar");
    const toggle = document.getElementById("sidebar-toggle-button");

    if (!app || !sidebar || !toggle) {
        console.error("Sidebar elements not found.");
        return;
    }

    function setSidebarOpen(open) {
        app.classList.toggle("sidebar-open", open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute(
            "aria-label",
            open ? "Close chats menu" : "Open chats menu"
        );
        toggle.title = open ? "Close chats menu" : "Open chats menu";
    }

    toggle.addEventListener("click", () => {
        setSidebarOpen(!app.classList.contains("sidebar-open"));
    });

    document.addEventListener("click", (event) => {
        if (!app.classList.contains("sidebar-open")) return;

        if (
            !sidebar.contains(event.target) &&
            !toggle.contains(event.target)
        ) {
            setSidebarOpen(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setSidebarOpen(false);
        }
    });

    sidebar.addEventListener("click", (event) => {
        const selectedChat = event.target.closest(
            "#users-list > *, #groups-list > *"
        );

        if (selectedChat) {
            setSidebarOpen(false);
        }
    });

    setSidebarOpen(false);

    console.log("Collapsible chat sidebar initialized.");
});
