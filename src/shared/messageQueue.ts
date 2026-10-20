/** Pending messages keep their conversation and attachment snapshot until dispatched. */
export class MessageQueue<T extends { id: string; conversationId: string }> {
  private entries: T[] = [];
  get size() { return this.entries.length; }
  push(entry: T) { if (!this.entries.some(item => item.id === entry.id)) this.entries.push(entry); }
  restore(entry: T) { if (!this.entries.some(item => item.id === entry.id)) this.entries.unshift(entry); }
  list(conversationId: string) { return this.entries.filter(entry => entry.conversationId === conversationId); }
  get(id: string) { return this.entries.find(entry => entry.id === id); }
  remove(id: string) { const index = this.entries.findIndex(entry => entry.id === id); return index < 0 ? undefined : this.entries.splice(index, 1)[0]; }
  takeNext() { return this.entries.shift(); }
  discardConversation(id: string) { this.entries = this.entries.filter(entry => entry.conversationId !== id); }
}
