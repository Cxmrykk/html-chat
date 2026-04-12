// --- IMPORT & EXPORT JSON ---
function exportChats() {
  const dataStr = JSON.stringify(chats, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `html-chat-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSingleChat(id) {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;

  const dataStr = JSON.stringify([chat], null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-timestamp-${chat.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importChats() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedChats = JSON.parse(event.target.result);
        if (!Array.isArray(importedChats))
          throw new Error("Invalid format: expected an array of chats.");

        let addedCount = 0;
        const existingIds = new Set(chats.map((c) => c.id));

        for (const chat of importedChats) {
          if (!chat.id || !chat.messages) continue;
          if (!existingIds.has(chat.id)) {
            chats.push(chat);
            existingIds.add(chat.id);
            addedCount++;
          }
        }

        chats.sort((a, b) => Number(b.id) - Number(a.id));
        if (!currentChatId && chats.length > 0) currentChatId = chats[0].id;

        saveState();
        renderApp();
        alert(`Successfully imported ${addedCount} new chat(s).`);
      } catch (err) {
        alert("Failed to import chats: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
