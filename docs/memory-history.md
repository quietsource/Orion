# Conversation memory in Orion 0.2.0

Open **Memory** beside the context meter in the chat composer. Its five tabs let you inspect and change the context available to a conversation. The controls use OrionFS locally; no embedding model, additional AI model, account, or remote service is needed.

## 1. Checkpoint timeline

Orion saves a checkpoint after a response is saved. Give an important milestone a name with **Save checkpoint**. Drag the horizontal slider or use its arrow keys to preview a checkpoint's recent messages, memories, assumptions, and Canvas documents. Previewing does not change the chat.

Choose **Continue from here** to create a named conversation branch. The branch restores the saved transcript, rolling summary, Canvas revisions, recall settings, assumptions, and OrionFS snapshot. Your original conversation remains available in history. The branch has its own OrionFS database; later changes in the original cannot leak into its snapshot.

Checkpoints start when this feature is enabled in Orion 0.2.0. Orion cannot reconstruct a memory state from before it saved a checkpoint. A checkpoint restores application context, not a model's internal hidden state or random sampling state. Answers can differ when you continue. Website actions, generated media files, and changes made outside the conversation are not reversed.

## 2. Assumption checkpoints

Add a confirmed constraint yourself, or review a consequential assumption recorded by the assistant. Entries distinguish model inference from a directly sourced user statement. A direct quotation is not automatically a user confirmation. Only the user can confirm a constraint.

Use **Save correction**, **Confirm**, or **Dismiss**. Corrected constraints take precedence over conflicting older evidence in future prompts. Recall excludes old source messages and recorded dependent answers. Existing answers are marked for review, with a shortcut to draft a revision request. **Revise dependent work** asks the model to explain affected conclusions and update relevant Canvas documents. Review the draft and send it when ready.

Dependency markers mean an answer was produced while an assumption was active. They are a review aid, not a proof that every sentence depends on that assumption. Orion does not silently overwrite answers, rerun tools, or modify original files.

## 3. Memory lenses

- **This conversation:** recall from this chat.
- **Named project:** recall from conversations assigned the same project name and memories labeled for that project. This is a memory grouping, not the disabled filesystem workspace feature.
- **Personal memories:** include memories explicitly labeled personal, alongside the current conversation.
- **All conversations:** allow the other conversations available in the engine's memory store.

Search stored memories and open their source messages. Pin an entry to prioritize it within the recall budget. Exclude an entry to prevent its recall. **Apply lens** saves scope, project membership, pins, and exclusions. Personal/project sharing labels save immediately. Exclusions take priority over pins. The inspector lists the newest 1,000 entries, with up to 100 search matches displayed at a time.

Restored branches remain isolated: a broader lens can inspect other conversations present in their frozen snapshot, but cannot reveal later events or live changes from other branches. Ordinary conversations share the original memory store; restored branches do not automatically publish their new memories into it.

Answers with automatically recalled memories have an expandable **Recalled … memories** record showing exactly those initial recall snippets. Memories explicitly retrieved later by a tool appear in that tool's result. The selected local model or hosted provider receives included memory text as part of its request. Context limits still apply; pins cannot exceed a model's available context budget.

## 4. Reviewed carry-forward packets

Use **Carry forward** to start a shorter continuation without copying the entire old transcript. Orion assembles a draft from confirmed constraints, recent user requests, pinned memories, and possible open questions. This is a local evidence selection, not an AI-generated or verified summary.

Edit the text, add decisions or constraints, uncheck unwanted items, and choose Canvas documents. Source links preserve attribution. **Create continuation** starts a new conversation containing only the reviewed packet and selected documents. The old engine's memory rows are not copied in secretly. New turns build new OrionFS memories normally.

The packet is limited to 24,000 selected characters. Prompts prioritize confirmed constraints and include packet records that fit the selected model's context budget. A small local context window may omit records; the model is told when this happens. Choose a concise packet or increase the context limit when needed.

## 5. Branch comparison

Choose two conversations from the same family in **Compare branches**. Orion shows message change counts, added/removed/changed memories, assumption changes, carried decisions and constraints, and Canvas revisions side by side. Use **Continue the “after” branch** to open your preferred path. Comparison is deterministic and local; nothing is merged or replaced automatically.

## Storage and deletion

Checkpoint transcripts, assumption records, memory lenses, packets, and compressed OrionFS snapshots are encrypted with Orion's existing local encryption key. Snapshot vectors are deduplicated; branches keep their own encrypted databases, which are decrypted during use and re-encrypted when idle or closing. Downloaded model weights and generated media are not encrypted.

Deleting a conversation removes its own checkpoints and branch database and cleans unreferenced snapshot objects. A surviving branch remains an independent copy: deleting its original does not erase context that branch intentionally preserved. Delete each branch as well if you want to remove those copies. Checkpoint history consumes disk space as conversations grow; it is retained until its conversation is deleted.

Memory-changing operations wait until inference has finished. No external actions are replayed during restoration or comparison.
