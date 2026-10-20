import type { Conversation } from "./types";

export function isReusableUntitledConversation(conversation: Conversation): boolean {
  return (conversation.title === "Untitled" || conversation.title === "New conversation") &&
    conversation.messages.length === 0 && !conversation.summary?.trim() && !conversation.localOnly && !conversation.privateVoice;
}
