// --- KEYBOARD & CLIPBOARD LISTENERS ---
$("#chat-input").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    if (isSuperSecretSettingsOpen && activeSuperSecretSetting) {
      saveSuperSecretSetting();
    } else if (editingMessageIndex !== null) {
      saveGlobalEdit();
    } else {
      sendMessage(0, e.shiftKey);
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.altKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    newChat();
    $("#chat-input").focus();
  }
  if (e.altKey && e.key.toLowerCase() === "w") {
    e.preventDefault();
    if (currentChatId) deleteChat(currentChatId);
  }
  if (e.altKey && e.key.toLowerCase() === "r") {
    e.preventDefault();
    if (currentChatId) renameChat(currentChatId);
  }
  if (e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    toggleSidebar();
  }
  if (e.altKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    toggleTitle();
  }

  if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    if (document.activeElement?.tagName === "TEXTAREA") return;
    e.preventDefault();
    const container = $("#chat-container");
    const msgs = Array.from(container.querySelectorAll(".msg"));
    if (!msgs.length) return;

    if (e.key === "ArrowDown") {
      const next = msgs.find((m) => m.offsetTop - 15 > container.scrollTop + 5);
      container.scrollTop = next ? next.offsetTop - 15 : container.scrollHeight;
    } else {
      const prev = msgs
        .slice()
        .reverse()
        .find((m) => m.offsetTop - 15 < container.scrollTop - 5);
      container.scrollTop = prev ? prev.offsetTop - 15 : 0;
    }
  }

  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    if (!chats.length) return;
    let idx = Math.max(
      0,
      chats.findIndex((c) => c.id === currentChatId),
    );
    if (e.key === "ArrowUp" && idx > 0) loadChat(chats[idx - 1].id);
    if (e.key === "ArrowDown" && idx < chats.length - 1)
      loadChat(chats[idx + 1].id);
  }

  if (
    !e.shiftKey &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.key === "ArrowUp" || e.key === "ArrowDown")
  ) {
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") {
      e.preventDefault();
      $("#chat-container").scrollBy({
        top: e.key === "ArrowDown" ? 150 : -150,
        behavior: "smooth",
      });
    }
  }
});

const toggleModifierMode = (e) => {
  if (e.key === "Control" || e.key === "Meta")
    document.body.classList.toggle("ctrl-down", e.type === "keydown");
  if (e.key === "Alt")
    document.body.classList.toggle("alt-down", e.type === "keydown");
};
window.addEventListener("keydown", toggleModifierMode);
window.addEventListener("keyup", toggleModifierMode);
window.addEventListener("blur", () => {
  document.body.classList.remove("ctrl-down");
  document.body.classList.remove("alt-down");
});

$("#chat-container").addEventListener("click", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const target =
    e.target.closest(".katex") ||
    e.target.closest("pre") ||
    e.target.closest("code");
  if (!target) return;

  let text = target.classList.contains("katex")
    ? target.querySelector("annotation")?.textContent ||
      target.querySelector(".katex-mathml math")?.getAttribute("alttext") ||
      ""
    : target.innerText;

  if (text) {
    e.preventDefault();
    navigator.clipboard.writeText(text).then(() => {
      const bg = target.style.backgroundColor;
      target.style.backgroundColor = "#ccc";
      setTimeout(() => (target.style.backgroundColor = bg), 100);
    });
  }
});
