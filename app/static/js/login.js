const loginForm = document.getElementById("login-form");
const messageElement = document.getElementById("message");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    messageElement.textContent = "";
    messageElement.className = "";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
        const response = await fetch("/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            messageElement.textContent =
                data.error || "Login failed.";

            messageElement.className = "error";
            return;
        }

        messageElement.textContent = "Login successful.";
        messageElement.className = "success";

        window.location.href = "/chat";
    } catch (error) {
        console.error("Login error:", error);

        messageElement.textContent =
            "Could not connect to the server.";

        messageElement.className = "error";
    }
});
