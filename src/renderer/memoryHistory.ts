import type { Conversation, Message } from "../shared/types";
import type {
  Assumption,
  CarryPacket,
  MemoryDashboard,
  MemoryContext,
  MemoryLens,
  MemorySource,
  ConversationCleanup,
  CleanupPreview,
} from "../shared/memoryHistory";
import "./memoryHistory.css";

type Host = {
  current(): Conversation | null;
  busy(): boolean;
  flush(): Promise<void>;
  activate(id: string, messageId?: string): Promise<void>;
  draft(text: string): void;
  rerender(): void;
  cleaned(conversationId: string, canvasIds: string[]): void;
  openPassage(name: string, passage: string, conversationId: string): void;
};
type Tab = "Timeline" | "Memory" | "More";
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const date = (time: number) =>
  new Date(time).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const button = (
  text: string,
  action: () => void | Promise<void>,
  className = "",
) => {
  const element = node("button", text, className);
  element.type = "button";
  element.onclick = () => {
    void action();
  };
  return element;
};

export function installMemoryHistory(host: Host) {
  const api = window.orion.memoryHistory;
  const trigger = button("History", () => open(), "memory-trigger");
  trigger.hidden = true;
  const syncVisibility = () => { trigger.hidden = !host.current()?.messages.some(message => Boolean(message.content.trim() || message.reasoning?.trim() || message.attachments?.length || message.canvasDocuments?.length || message.toolCalls?.length || message.webResearch?.steps.length)); };
  trigger.title =
    "Conversation history, memory, handoff and cleanup";
  document.getElementById("context-meter")!.after(trigger);
  const dialog = node("dialog", undefined, "memory-studio");
  const header = node("header", undefined, "memory-studio-head");
  const heading = node("div");
  heading.append(
    node("h2", "Conversation history"),
  );
  const close = button("×", () => dialog.close(), "memory-close");
  close.setAttribute("aria-label", "Close conversation history");
  header.append(heading, close);
  const subtitle = node("p", "", "memory-subtitle");
  const navigation = node("nav", undefined, "memory-tabs");
  navigation.setAttribute("aria-label", "Conversation history sections");
  let content = node("section", undefined, "memory-studio-body");
  const status = node("p", "", "memory-status");
  status.setAttribute("role", "status");
  dialog.append(header, subtitle, navigation, content, status);
  document.body.append(dialog);
  let tab: Tab = "Timeline",
    data: MemoryDashboard | undefined,
    conversationId = "",
    request = 0,
    changing = false;
  const cache = new Map<string, MemoryContext>();
  const tabs: Tab[] = ["Timeline", "Memory", "More"];
  const navButtons = tabs.map((name) => {
    const item = button(name, async () => {
      if (changing) return;
      tab = name;
      await draw();
    });
    navigation.append(item);
    return item;
  });
  dialog.addEventListener("close", () => {
    request++;
    trigger.focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
  const note = (text: string) => node("p", text, "memory-note");
  const field = (label: string, input: HTMLElement) => {
    const element = node("label", undefined, "memory-field");
    element.append(node("span", label), input);
    return element;
  };
  const input = (placeholder: string, value = "") => {
    const element = node("input");
    element.placeholder = placeholder;
    element.value = value;
    return element;
  };
  const source = (value: MemorySource) =>
    button(
      value.label || "Source",
      async () => {
        dialog.close();
        await host.activate(value.conversationId, value.messageId);
      },
      "memory-source",
    );
  function mutation(
    action: () => Promise<unknown>,
    then?: () => Promise<void>,
  ) {
    return async () => {
      if (changing) return;
      if (host.busy()) {
        status.textContent =
          "Wait for the current response to finish before changing memory.";
        return;
      }
      changing = true;
      dialog.setAttribute("aria-busy", "true");
      status.textContent = "Saving…";
      content
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = true));
      try {
        await action();
        data = await api.dashboard(conversationId);
        cache.set(conversationId, data.context);
        host.rerender();
        status.textContent = "";
        if (then) await then();
        else await draw();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
        content
          .querySelectorAll<HTMLButtonElement>("button")
          .forEach((b) => (b.disabled = false));
      } finally {
        changing = false;
        dialog.removeAttribute("aria-busy");
      }
    };
  }
  async function open() {
    const conversation = host.current();
    syncVisibility();
    if (!conversation || trigger.hidden) return;
    conversationId = conversation.id;
    if (!dialog.open) dialog.showModal();
    content.replaceChildren(note("Loading conversation history…"));
    status.textContent = "";
    const sequence = ++request;
    try {
      await host.flush();
      const next = await api.dashboard(conversationId);
      if (sequence !== request || !dialog.open) return;
      data = next;
      cache.set(conversationId, next.context);
      await draw();
    } catch (error) {
      if (sequence === request) status.textContent = String(error);
    }
  }
  async function draw() {
    status.textContent = "";
    if (!data) return;
    const sequence = ++request;
    subtitle.textContent = `${data.context.branchName}${host.current()?.localOnly ? " · Local only" : ""} · ${data.checkpoints.length} checkpoints · ${data.context.lens.scope} memory${host.busy() ? " · Read only while generating" : ""}`;
    navButtons.forEach((item, i) =>
      item.setAttribute("aria-current", String(tabs[i] === tab)),
    );
    content.replaceChildren();
    if (tab === "Timeline") timeline();
    if (tab === "Memory") {
      const rehearsalPanel = rehearsal();
      const memoryDetails = node("details", undefined, "history-assumptions");
      memoryDetails.append(node("summary", "Memory settings and saved items"));
      lens();
      for (const child of [...content.children]) memoryDetails.append(child);
      const assumptionDetails = node("details", undefined, "history-assumptions");
      assumptionDetails.append(node("summary", "Decisions and assumptions"));
      assumptions();
      for (const child of [...content.children]) assumptionDetails.append(child);
      content.replaceChildren();
      content.append(rehearsalPanel, memoryDetails, assumptionDetails);
    }
    if (tab === "More") more();
  }
  function rehearsal() {
    const panel = node("section", undefined, "memory-rehearsal");
    panel.append(node("h3", "What Orion remembers"), note("Preview the local passages that match a question before relying on them. Nothing here is sent to a model."));
    const query = input("Ask what Orion would remember about…"); query.maxLength = 2000;
    const run = button("Preview recall", async () => {
      const list = panel.querySelector<HTMLElement>(".memory-rehearsal-results")!;
      if (!query.value.trim()) { query.focus(); return; }
      run.disabled = true; run.textContent = "Finding sources…"; list.replaceChildren(note("Searching this conversation’s allowed OrionFS memories…"));
      try {
        const result = await api.retrievalPreview(conversationId, query.value), selected = structuredClone((await api.context(conversationId)).lens);
        list.replaceChildren();
        if (!result.items.length) list.append(note("No matching memory or document passages were found."));
        for (const item of result.items) {
          const card = node("article", undefined, "memory-entry"), correction = node("textarea"); correction.value = item.content; correction.maxLength = 4000;
          card.append(node("p", `${item.sourceName ?? "Conversation memory"}${item.sourcePage ? ` · page ${item.sourcePage}` : item.sourcePart ? ` · passage ${item.sourcePart}` : ""}`), node("small", item.reason ?? "Selected by local recall."), correction);
          const actions = node("div", undefined, "memory-row");
          actions.append(button("Save correction", mutation(() => api.memoryEdit(conversationId, item.id, correction.value))));
          const retention = node("select"); retention.setAttribute("aria-label", "Memory retention");
          for (const [value,label] of [["temporary","Temporary · 30 days"],["conversation","Conversation only"],["durable","Durable"]]) retention.add(new Option(label,value));
          retention.value = item.retention ?? "conversation";
          retention.onchange = () => void mutation(() => api.memoryRetention(conversationId,item.id,retention.value as "temporary"|"conversation"|"durable"))();
          actions.append(retention, button("Exclude here", mutation(async () => { selected.excluded = [...new Set([...selected.excluded,item.id])]; await api.lens(conversationId,selected); })), button("Never save", mutation(() => api.memoryRetention(conversationId,item.id,"never-save"))));
          card.append(actions); list.append(card);
        }
      } catch (error) { list.replaceChildren(note(error instanceof Error ? error.message : String(error))); }
      finally { run.disabled = false; run.textContent = "Preview recall"; }
    }, "primary");
    query.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); run.click(); } };
    panel.append(node("div", undefined, "memory-row")); panel.lastElementChild!.append(query,run);
    panel.append(node("div", undefined, "memory-rehearsal-results"));
    return panel;
  }
  function more() {
    const root = content, nav = node("nav", undefined, "memory-more-nav"), body = node("section", undefined, "memory-more-body");
    root.append(nav, body);
    const sections = ["Cleanup", "Compare", "Local handoff"] as const;
    let selected: typeof sections[number] | null = null, renderVersion = 0;
    const render = async () => {
      const version = ++renderVersion;
      nav.replaceChildren(); body.replaceChildren();
      for (const name of sections) { const item = button(name, () => { selected = name; void render(); }); item.setAttribute("aria-current", String(name === selected)); nav.append(item); }
      if (selected === null) body.append(note("Open cleanup, compare branches, or prepare a local handoff when you need it."));
      if (selected === "Cleanup") { body.append(note("Preparing a review of saved items…")); try { const preview = await api.cleanupPreview(conversationId); if (version !== renderVersion) return; body.replaceChildren(); content = body; cleanup(preview); content = root; } catch(error) { if(version === renderVersion) body.replaceChildren(note(String(error))); } }
      if (selected === "Compare") { content = body; compare(); content = root; }
      if (selected === "Local handoff") { body.append(note("Building a reviewable packet from local evidence…")); try { const packet = await api.packet(conversationId); if (version === renderVersion) { content = body; carry(packet); content = root; } } catch(error) { if(version === renderVersion) body.replaceChildren(note(String(error))); } }
    };
    void render();
  }  function timeline() {
    const checkpoints = data!.checkpoints;
    const capture = node("div", undefined, "memory-row");
    const name = input("Checkpoint name (optional)");
    name.maxLength = 100;
    capture.append(
      name,
      button(
        "Save checkpoint",
        mutation(async () => {
          await host.flush();
          await api.checkpoint(conversationId, name.value);
        }),
        "primary",
      ),
    );
    content.append(
      node("h3", "Return to a point in this conversation"),
      note(
        "Preview a checkpoint, then continue in a new branch. The original chat is preserved. Web actions, generated files and other external effects are not undone.",
      ),
      capture,
    );
    if (!checkpoints.length) {
      content.append(
        note(
          "A checkpoint is saved after each completed response. You can also save one now. Earlier history cannot be reconstructed retroactively.",
        ),
      );
      return;
    }
    const slider = node("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(checkpoints.length - 1);
    slider.value = slider.max;
    slider.step = "1";
    slider.setAttribute("aria-label", "Conversation checkpoint");
    const endpoints = node("div", undefined, "memory-endpoints");
    endpoints.append(
      node("span", date(checkpoints[0]!.createdAt)),
      node("span", "Latest checkpoint"),
    );
    const preview = node("div", undefined, "memory-preview");
    const branchName = input("Name the new branch");
    branchName.maxLength = 100;
    const restore = button(
      "Continue from here",
      mutation(async () => {
        const id = await api.branch(
          checkpoints[Number(slider.value)]!.id,
          branchName.value,
        );
        dialog.close();
        await host.activate(id);
      }),
      "primary",
    );
    content.append(
      slider,
      endpoints,
      preview,
      field("New branch", branchName),
      restore,
    );
    let previewRequest = 0;
    async function update() {
      const selected = checkpoints[Number(slider.value)]!,
        sequence = ++previewRequest,
        outer = request;
      slider.setAttribute(
        "aria-valuetext",
        `${selected.label}, ${date(selected.createdAt)}`,
      );
      restore.disabled = true;
      preview.replaceChildren(
        node("h3", selected.label),
        note(
          `${date(selected.createdAt)} · ${selected.messageCount} messages · ${selected.memoryCount} memories · ${selected.canvasCount} documents`,
        ),
      );
      try {
        const saved = await api.preview(selected.id);
        if (sequence !== previewRequest || outer !== request) return;
        const list = node("div", undefined, "memory-preview-messages");
        for (const message of saved.messages) {
          const item = node("div");
          item.append(
            node("strong", message.role === "user" ? "You" : "Assistant"),
            node("p", message.content.slice(0, 900)),
          );
          list.append(item);
        }
        const details = node("details");
        details.append(
          node(
            "summary",
            `Memory state · ${saved.memories.length} entries · ${saved.context.assumptions.filter((a) => a.status !== "dismissed").length} assumptions`,
          ),
        );
        for (const memory of saved.memories)
          details.append(note(memory.content));
        for (const assumption of saved.context.assumptions.filter(
          (a) => a.status !== "dismissed",
        ))
          details.append(note(`[${assumption.status}] ${assumption.text}`));
        preview.append(list, details);
        if (saved.canvases.length)
          preview.append(
            note(`Canvas: ${saved.canvases.map((doc) => doc.name).join(", ")}`),
          );
        restore.disabled = host.busy();
      } catch (error) {
        if (outer === request) status.textContent = String(error);
      }
    }
    let sliderTimer: ReturnType<typeof setTimeout> | undefined;
    slider.oninput = () => {
      previewRequest++;
      restore.disabled = true;
      if (sliderTimer) clearTimeout(sliderTimer);
      sliderTimer = setTimeout(() => {
        void update();
      }, 120);
    };
    void update();
  }
  function assumptions() {
    content.append(
      node("h3", "Make consequential assumptions explicit"),
      note(
        "Confirmed constraints guide future replies. Correcting an assumption marks work made under it for review; Orion does not silently rewrite existing answers or documents.",
      ),
    );
    const active = data!.context.assumptions.filter(
      (item) => item.status !== "dismissed",
    );
    if (!active.length)
      content.append(
        note(
          "No assumptions recorded. Add a constraint yourself, or the model can record one when it materially affects the task.",
        ),
      );
    for (const item of active) {
      const card = node("section", undefined, "memory-entry");
      const text = node("textarea");
      text.value = item.text;
      text.maxLength = 1000;
      text.setAttribute("aria-label", "Assumption");
      card.append(
        note(
          `${item.kind === "inferred" ? "Model inference" : "User statement"} · ${item.status}${item.previous ? " · Corrected" : ""}`,
        ),
        text,
      );
      if (item.previous) card.append(note(`Previously: ${item.previous}`));
      const actions = node("div", undefined, "memory-row");
      actions.append(
        button(
          "Save correction",
          mutation(() =>
            api.assumption(conversationId, "save", {
              id: item.id,
              text: text.value,
            }),
          ),
        ),
        button(
          "Confirm",
          mutation(() =>
            api.assumption(conversationId, "confirm", { id: item.id }),
          ),
        ),
        button(
          "Dismiss",
          mutation(() =>
            api.assumption(conversationId, "dismiss", { id: item.id }),
          ),
        ),
      );
      if (item.correctedAt)
        actions.append(
          button("Revise dependent work", () => {
            dialog.close();
            host.draft(
              `The assumption “${item.previous}” was corrected to “${item.text}”. Review your earlier conclusions and Canvas documents that rely on the old assumption. Explain what changes and update any affected Canvas document with complete revisions. Keep unrelated work intact.`,
            );
          }),
        );
      for (const messageId of item.sourceMessageIds)
        actions.append(
          source({ conversationId, messageId, label: "Original evidence" }),
        );
      card.append(actions);
      content.append(card);
    }
    const text = node("textarea");
    text.placeholder =
      "A constraint or decision the assistant should keep in mind…";
    text.maxLength = 1000;
    text.setAttribute("aria-label", "New confirmed constraint");
    content.append(
      field("Add a confirmed constraint", text),
      button(
        "Add constraint",
        mutation(() =>
          api.assumption(conversationId, "save", { text: text.value }),
        ),
        "primary",
      ),
    );
    const dismissed = data!.context.assumptions.filter(
      (a) => a.status === "dismissed",
    );
    if (dismissed.length) {
      const details = node("details");
      details.append(node("summary", `${dismissed.length} dismissed`));
      for (const item of dismissed) details.append(note(item.text));
      content.append(details);
    }
  }
  function lens() {
    const selected: MemoryLens = structuredClone(data!.context.lens);
    content.append(
      node("h3", "Choose what this conversation can recall"),
      note(
        data!.context.branch
          ? "This branch reads its frozen snapshot plus its own new turns. Changing the lens cannot reveal events that happened after its checkpoint."
          : "Conversation keeps recall local to this chat. Project shares a named group. Personal includes memories you explicitly mark as personal. All includes other conversations. Pins add individual memories; exclusions always win.",
      ),
    );
    const scope = node("select");
    for (const [value, label] of [
      ["conversation", "This conversation"],
      ["project", "Named project"],
      ["personal", "Personal memories"],
      ["all", "All conversations"],
    ])
      scope.add(new Option(label, value));
    scope.value = selected.scope;
    const project = input("Project name", selected.project);
    project.maxLength = 80;
    const listId = `memory-projects-${crypto.randomUUID()}`,
      projects = node("datalist");
    projects.id = listId;
    for (const name of data!.projects) projects.append(new Option(name, name));
    project.setAttribute("list", listId);
    const controls = node("div", undefined, "memory-row");
    controls.append(
      field("Recall scope", scope),
      field("Project membership", project),
      projects,
    );
    const apply = button(
      "Apply lens",
      mutation(async () => {
        selected.scope = scope.value as MemoryLens["scope"];
        selected.project = project.value;
        await api.lens(conversationId, selected);
      }),
      "primary",
    );
    const search = input("Search memory content…");
    search.setAttribute("aria-label", "Search OrionFS memories");
    const list = node("div");
    content.append(
      controls,
      apply,
      note(
        `Inspecting ${data!.memories.length} of ${data!.memoryTotal} available memories. Pin/exclude changes are applied with the lens. Personal/project labels save immediately.`,
      ),
      search,
      list,
    );
    const render = () => {
      list.replaceChildren();
      const query = search.value.toLowerCase();
      const matches = data!.memories.filter((memory) =>
        memory.content.toLowerCase().includes(query),
      );
      for (const memory of matches.slice(0, 100)) {
        const row = node("section", undefined, "memory-entry");
        const editable = node("textarea"); editable.value = memory.content; editable.maxLength = 4000; editable.setAttribute("aria-label", "Correct saved memory");
        row.append(
          editable,
          note(
            `${memory.sourceName ?? memory.type}${memory.sourcePage ? ` · page ${memory.sourcePage}` : memory.sourcePart ? ` · passage ${memory.sourcePart}` : ""} · ${memory.retention ?? "conversation"} · ${date(memory.createdAt)}${memory.conversationId === conversationId ? " · This conversation" : ""}`,
          ),
        );
        const actions = node("div", undefined, "memory-row");
        actions.append(button("Save correction", mutation(() => api.memoryEdit(conversationId, memory.id, editable.value))));
        for (const [key, label] of [
          ["pinned", "Pin"],
          ["excluded", "Exclude"],
        ] as const) {
          const check = node("input");
          check.type = "checkbox";
          check.checked = selected[key].includes(memory.id);
          check.onchange = () => {
            selected[key] = check.checked
              ? [...new Set([...selected[key], memory.id])]
              : selected[key].filter((id) => id !== memory.id);
          };
          actions.append(field(label, check));
        }
        const tag = node("select");
        tag.setAttribute("aria-label", "Memory sharing label");
        for (const [value, label] of [
          ["none", "No sharing label"],
          ["personal", "Personal"],
          ["project", "Project"],
        ])
          tag.add(new Option(label, value));
        tag.value = data!.context.tags?.[memory.id]?.scope ?? "none";
        tag.onchange = () => {
          void mutation(async () => {
            selected.project = project.value;
            selected.scope = scope.value as MemoryLens["scope"];
            await api.lens(conversationId, selected);
            await api.tag(
              conversationId,
              memory.id,
              tag.value as "personal" | "project" | "none",
            );
          })();
        };
        actions.append(tag);
        const retention = node("select"); retention.setAttribute("aria-label", "Memory retention");
        for (const [value,label] of [["temporary","Temporary · 30 days"],["conversation","Conversation only"],["durable","Durable"],["never-save","Never save · remove from memory"]]) retention.add(new Option(label,value));
        retention.value = memory.retention ?? "conversation";
        retention.onchange = () => void mutation(() => api.memoryRetention(conversationId,memory.id,retention.value as "temporary"|"conversation"|"durable"|"never-save"))();
        actions.append(retention);
        if (memory.sourceMessageId)
          actions.append(
            memory.sourceName ? button(`Open ${memory.sourceName}${memory.sourcePage ? ` · page ${memory.sourcePage}` : memory.sourcePart ? ` · passage ${memory.sourcePart}` : ""}`, () => host.openPassage(memory.sourceName!, memory.content, memory.conversationId), "memory-source") : source({ conversationId: memory.conversationId, messageId: memory.sourceMessageId, label: "Source message" }),
          );
        row.append(actions);
        list.append(row);
      }
      if (matches.length > 100)
        list.append(
          note(
            "Showing the first 100 matches. Refine your search to find a specific memory.",
          ),
        );
      if (!matches.length) list.append(note("No matching memories."));
    };
    search.oninput = render;
    render();
  }
  function carry(packet: CarryPacket) {
    content.replaceChildren(
      node("h3", "Hand off to a local model"),
      note(
        "Choose the context and Canvas documents to keep, then start a fresh conversation with a downloaded model. This handoff stays on your computer; network tools and hosted models are unavailable in the new conversation.",
      ),
    );
    const title = input("Continuation title", packet.title);
    title.maxLength = 160;
    content.append(field("New conversation", title));
    const model = node("select"); model.setAttribute("aria-label", "Local handoff model");
    model.add(new Option("Loading local models…", "")); model.disabled = true;
    content.append(field("Local model", model));
    const total = note("");
    const updateTotal = () => {
      const chars = packet.items
        .filter((item) => item.included)
        .reduce((n, item) => n + item.text.length, 0);
      total.textContent = `${chars.toLocaleString()} / 24,000 characters selected · approximately ${Math.ceil(chars / 4).toLocaleString()} tokens (model-dependent)`;
    };
    const items = node("div");
    function addItem(item: CarryPacket["items"][number]) {
      const row = node("section", undefined, "memory-entry"),
        check = node("input");
      check.type = "checkbox";
      check.checked = item.included;
      check.onchange = () => {
        item.included = check.checked;
        updateTotal();
      };
      const text = node("textarea");
      text.value = item.text;
      text.maxLength = 8000;
      text.setAttribute("aria-label", `${item.section} text`);
      text.oninput = () => {
        item.text = text.value;
        updateTotal();
      };
      row.append(field(item.section, check), text);
      for (const evidence of item.sources) row.append(source(evidence));
      items.append(row);
    }
    packet.items.forEach(addItem);
    content.append(items);
    const kind = node("select");
    for (const section of [
      "decisions",
      "constraints",
      "memories",
      "questions",
      "context",
    ])
      kind.add(new Option(section, section));
    const add = node("div", undefined, "memory-row");
    add.append(
      kind,
      button("Add item", () => {
        const item = {
          id: crypto.randomUUID(),
          section: kind.value as CarryPacket["items"][number]["section"],
          text: "",
          included: true,
          sources: [],
        };
        packet.items.push(item);
        addItem(item);
      }),
    );
    content.append(add);
    const docs = new Map(
      host
        .current()
        ?.messages.flatMap((message) => message.canvasDocuments ?? [])
        .map((doc) => [doc.id, doc]),
    );
    if (docs.size) {
      content.append(node("h3", "Canvas documents"));
      for (const doc of docs.values()) {
        const check = node("input");
        check.type = "checkbox";
        check.checked = packet.canvasIds.includes(doc.id);
        check.onchange = () => {
          packet.canvasIds = check.checked
            ? [...packet.canvasIds, doc.id]
            : packet.canvasIds.filter((id) => id !== doc.id);
        };
        content.append(field(doc.name, check));
      }
    }
    content.append(
      total,
      button(
        "Start local handoff",
        mutation(async () => {
          packet.title = title.value;
          packet.model = model.value;
          const id = await api.carry(conversationId, packet);
          dialog.close();
          await host.activate(id);
        }),
        "primary",
      ),
    );
    const start = content.querySelector<HTMLButtonElement>("button.primary")!;
    start.disabled = true;
    const handoffRequest = request;
    void window.orion.listModels().then(models => {
      if (handoffRequest !== request) return;
      const local = models.filter(item => item.source !== "api" && !/(?:[-_:]cloud)(?:$|[-_:])/i.test(item.name));
      model.replaceChildren();
      for(const item of local)model.add(new Option(String(item.details?.label ?? item.details?.family ?? item.name), item.name));
      if(!local.length) { model.add(new Option("Install a conversational model first", "")); return; }
      if(local.some(item => item.name === packet.model))model.value = packet.model;
      model.disabled = false; start.disabled = host.busy();
    }).catch(error => { if(handoffRequest === request)status.textContent = String(error); });
    updateTotal();
  }
  function cleanup(preview: CleanupPreview) {
    content.replaceChildren(node("h3", "Clean up this conversation"), note("Review exactly what will change before removing it. Orion saves an encrypted recovery checkpoint first, so the latest cleanup can be undone."));
    content.append(button("Undo last cleanup", mutation(async () => { if (!await api.cleanupUndo(conversationId)) throw Error("There is no cleanup to undo."); await host.activate(conversationId); }), "secondary"));
    const selection: ConversationCleanup = { memoryIds: [], checkpointIds: [], assumptionIds: [], canvasIds: [], attachmentIds: [] };
    const filter = input("Filter by text or document name…"); filter.setAttribute("aria-label", "Filter cleanup items");
    const list = node("div"), summary = note("Nothing selected"), reviewPane = node("section");
    const rows: Array<{key: keyof ConversationCleanup; id: string; text: string; date?: number}> = [
      ...preview.memories.map(item => ({key:"memoryIds" as const,id:item.id,text:item.content,date:item.createdAt})),
      ...preview.checkpoints.map(item => ({key:"checkpointIds" as const,id:item.id,text:item.label,date:item.createdAt})),
      ...preview.assumptions.map(item => ({key:"assumptionIds" as const,id:item.id,text:item.text,date:item.updatedAt})),
      ...preview.documents.map(item => ({key:"canvasIds" as const,id:item.id,text:item.name})),
      ...preview.attachments.map(item => ({key:"attachmentIds" as const,id:item.id,text:`${item.name} · ${(item.bytes/1048576).toFixed(1)} MB`}))
    ];
    const labels: Record<keyof ConversationCleanup,string> = {memoryIds:"Saved memories",checkpointIds:"Checkpoints",assumptionIds:"Dismissed assumptions",canvasIds:"Canvas copies",attachmentIds:"Unused attachment cache (all conversations)"};
    const updateSelection = () => { const count=Object.values(selection).reduce((sum,ids)=>sum+ids.length,0); summary.textContent=count ? `${count} items selected` : "Nothing selected"; reviewPane.replaceChildren(); review.disabled=!count||host.busy(); };
    const render = () => {
      list.replaceChildren();
      const query=filter.value.trim().toLocaleLowerCase();
      for(const key of Object.keys(labels) as Array<keyof ConversationCleanup>) {
        const matches=rows.filter(row=>row.key===key&&row.text.toLocaleLowerCase().includes(query));
        if(!matches.length)continue;
        const group=node("details"); group.open=true;group.append(node("summary",`${labels[key]} · ${matches.length}`));
        for(const row of matches) {
          const check=node("input");check.type="checkbox";check.checked=selection[key].includes(row.id);
          check.onchange=()=>{selection[key]=check.checked?[...selection[key],row.id]:selection[key].filter(id=>id!==row.id);updateSelection();};
          const label=field(row.text,check);label.classList.add("history-cleanup-item");
          if(row.date)label.append(node("small",date(row.date)));
          group.append(label);
        }
        list.append(group);
      }
      if(!list.children.length)list.append(note("No matching saved items."));
    };
    const review=button("Review cleanup",()=>{
      reviewPane.replaceChildren(node("h3","Review selected items"),note("These items will be removed from the active conversation. Orion will keep an encrypted checkpoint so you can undo this cleanup."));
      for(const key of Object.keys(labels) as Array<keyof ConversationCleanup>) {
        const selected=rows.filter(row=>row.key===key&&selection[key].includes(row.id));
        if(!selected.length)continue;
        reviewPane.append(node("h4",`${labels[key]} · ${selected.length}`));
        const selectedList=node("ul"); for(const row of selected)selectedList.append(node("li",row.text));reviewPane.append(selectedList);
      }
      const frozen=structuredClone(selection);
      reviewPane.append(button("Remove selected items",mutation(async()=>{
        await api.cleanup(conversationId,frozen);
        host.cleaned(conversationId,frozen.canvasIds);
        await host.activate(conversationId);
      }),"primary"));
      reviewPane.scrollIntoView({block:"nearest",behavior:"smooth"});
    });
    filter.oninput=render;
    content.append(filter,summary,list,review,reviewPane);render();updateSelection();
  }
  function compare() {
    content.append(
      node("h3", "Compare paths through the same conversation"),
      note(
        "Differences are calculated locally. Inspect decisions, memories, assumptions and document revisions before deciding which branch to continue. Nothing is merged automatically.",
      ),
    );
    const branches = data!.branches;
    if (branches.length < 2) {
      content.append(
        note(
          "Create a branch from a checkpoint or a carry-forward continuation to compare it with the original.",
        ),
      );
      return;
    }
    const left = node("select"),
      right = node("select");
    left.setAttribute("aria-label", "Before branch");
    right.setAttribute("aria-label", "After branch");
    for (const item of branches) {
      left.add(new Option(`${item.name} · ${item.title}`, item.id));
      right.add(new Option(`${item.name} · ${item.title}`, item.id));
    }
    left.value = conversationId;
    right.value = branches.find((item) => item.id !== conversationId)!.id;
    const controls = node("div", undefined, "memory-compare-grid");
    controls.append(field("Before", left), field("After", right));
    const result = node("section");
    content.append(
      controls,
      button(
        "Compare",
        async () => {
          const sequence = ++request;
          status.textContent = "Comparing…";
          try {
            const value = await api.compare(left.value, right.value);
            if (sequence !== request) return;
            status.textContent = "";
            result.replaceChildren();
            result.append(
              note(
                `Messages: +${value.messages.added} added · −${value.messages.removed} removed · ${value.messages.changed} changed`,
              ),
            );
            for (const [label, delta] of [
              ["Memories", value.memories],
              ["Assumptions", value.assumptions],
              ["Carried decisions / constraints", value.decisions],
            ] as const) {
              result.append(node("h3", label));
              if (
                !delta.added.length &&
                !delta.removed.length &&
                !delta.changed.length
              )
                result.append(note("No changes."));
              const text = (item: {
                text?: string;
                content?: string;
                status?: string;
              }) =>
                `${item.text ?? item.content ?? ""}${item.status ? ` [${item.status}]` : ""}`;
              for (const item of delta.added)
                result.append(node("p", `+ ${text(item)}`, "memory-added"));
              for (const item of delta.removed)
                result.append(node("p", `− ${text(item)}`, "memory-removed"));
              for (const item of delta.changed) {
                const row = node("div", undefined, "memory-compare-grid");
                row.append(
                  node("p", text(item.before), "memory-removed"),
                  node("p", text(item.after), "memory-added"),
                );
                result.append(row);
              }
            }
            result.append(node("h3", "Canvas revisions"));
            if (!value.canvases.length)
              result.append(note("No document changes."));
            for (const doc of value.canvases) {
              const details = node("details");
              details.append(node("summary", `${doc.name} · ${doc.status}`));
              const panes = node("div", undefined, "memory-compare-grid");
              panes.append(
                node("pre", doc.before || "(not present)"),
                node("pre", doc.after || "(not present)"),
              );
              details.append(panes);
              result.append(details);
            }
            result.append(
              button("Continue the “after” branch", async () => {
                dialog.close();
                await host.activate(right.value);
              }),
            );
          } catch (error) {
            if (sequence === request) status.textContent = String(error);
          }
        },
        "primary",
      ),
      result,
    );
  }
  return {
    syncVisibility,
    async refresh() {
      const id = host.current()?.id;
      syncVisibility();
      if (!id || trigger.hidden) return;
      try {
        const latest = await api.context(id);
        cache.set(id, latest);
        if (host.current()?.id === id) {
          trigger.textContent = "History";
        }
      } catch (error) {
        console.error("Memory controls:", error);
      }
    },
    assumptions(id: string) {
      return (
        cache
          .get(id)
          ?.assumptions.filter((item) => item.status !== "dismissed") ?? []
      );
    },
    receipt(message: Message, conversation: Conversation): HTMLElement | null {
      if(message.role !== "assistant")return null;
      const memories=message.memoryUsed??[], files=[...new Map((message.sourceFiles??[]).map(file=>[file.id,file])).values()];
      if(!memories.length&&!files.length)return null;
      const details=node("details",undefined,"source-receipt");
      details.append(node("summary",`Sources · ${memories.length+files.length}`),note("These passages were supplied as context. Orion cannot verify which ones shaped the answer."));
      for(const memory of memories) {
        const row=node("div",undefined,"source-receipt-item");row.append(node("span",`${memory.sourceName ?? "OrionFS memory"}${memory.sourcePage ? ` · page ${memory.sourcePage}` : memory.sourcePart ? ` · passage ${memory.sourcePart}` : ""}`),node("p",memory.text),note(memory.reason ?? "Selected by local recall."));
        row.append(button(memory.sourceName ? "Open passage in Canvas" : "Open source message",async()=>{try{if(memory.sourceName)host.openPassage(memory.sourceName,memory.text,memory.conversationId);else await host.activate(memory.conversationId,memory.messageId);}catch{row.append(note("The source is no longer available."));}},"memory-source"));details.append(row);
      }
      for(const file of files) {
        const row=node("div",undefined,"source-receipt-item");row.append(node("span","Attached file"),node("p",file.name));
        row.append(button("Open message",async()=>{try{await host.activate(file.conversationId,file.messageId);}catch{row.append(note("The source is no longer available."));}},"memory-source"));details.append(row);
      }
      return details;
    },
    dependencyNotice(
      message: Message,
      conversation: Conversation,
    ): HTMLElement | null {
      if (message.role !== "assistant") return null;
      const changed = (cache.get(conversation.id)?.assumptions ?? []).filter(
        (item) =>
          item.correctedAt &&
          message.createdAt < item.correctedAt &&
          (message.assumptionIds?.includes(item.id) ||
            message.createdAt >= item.createdAt),
      );
      if (!changed.length) return null;
      const notice = button(
        "Assumption changed · Review this answer and its documents",
        () => {
          host.draft(
            `Review the answer beginning “${message.content.slice(0, 160)}”${message.canvasDocuments?.length ? " and its Canvas documents" : ""}. ${changed.map((item) => `“${item.previous}” was corrected to “${item.text}”.`).join(" ")} Explain affected conclusions and provide complete corrected revisions.`,
          );
        },
        "memory-dependency",
      );
      return notice;
    },
  };
}
