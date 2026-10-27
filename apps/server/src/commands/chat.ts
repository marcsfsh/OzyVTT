import { ChatDeleteSchema, ChatSendSchema } from "@vtt/domain/commands";
import { CHAT_MAX_LENGTH, chatLength, cleanChatText } from "../chat.js";
import { playerFeedId } from "../combat-log.js";
import { GameAccessDeniedError } from "../authorization.js";
import { CommandRejectedError } from "../game-store.js";
import { defineCommand } from "./pipeline.js";
import { claimedCharacterIds, gmGradeLabelOf, isGmGrade, sessionIdOf } from "./kit.js";

// Table chat (ADR-0038): public lines, and whispers between the GM and one party character. The author comes from the
// token, never from the request; a line never touches the game state, so it has no revision.

export const chatCommands = [
  defineCommand({
    type: "chat.send",
    operationId: "sendChat",
    description:
      "Says a line at the table: public to the GM and every player, or with `whisperTo` a whisper between the GM and one party character (the GM sends a character's id, a player sends `gm`). Plain text of 1 to 500 characters after the server folds line breaks and removes control characters; a line starting with `/` is refused, since `/roll` belongs to the dice. A player speaks as a character they have claimed, named by `actorId` when they play several. The response's `entryId` is the line's id as the sender's feed holds it. Five lines in ten seconds per session (ten for the GM).",
    summary: "Say a line at the table, or whisper between the GM and one character.",
    schema: ChatSendSchema,
    malformed: "The chat line is malformed.",
    async run({ principal, request }, kit) {
      const gm = isGmGrade(principal);
      const idFor = (id: number) => (gm ? id : playerFeedId(id));
      const earlier = kit.context.chat.byCommand(request.commandId);
      if (earlier) return { duplicate: true, entryId: idFor(earlier.entry.id) };

      const text = cleanChatText(request.text);
      if (text === null) throw new CommandRejectedError("Type something to say.");
      if (chatLength(text) > CHAT_MAX_LENGTH)
        throw new CommandRejectedError(`A line holds up to ${CHAT_MAX_LENGTH} characters.`);
      if (text.startsWith("/"))
        throw new CommandRejectedError("A line can't start with /. Use /roll and a formula to roll dice.");

      const state = kit.read();
      const sessionId = sessionIdOf(principal);
      let author: { name: string; role: "gm" | "player"; actorId?: string };
      let whisper: { characterId: string; name: string } | undefined;
      if (gm) {
        author = { name: gmGradeLabelOf(principal), role: "gm" };
        if (request.actorId !== undefined) throw new CommandRejectedError("The GM speaks as the GM.");
        if (request.whisperTo === "gm") throw new CommandRejectedError("Whisper to one of the party's characters.");
        if (request.whisperTo !== undefined) {
          const character = state.actors.find(
            (actor) => actor.id === request.whisperTo && actor.kind === "player-character" && !actor.archived
          );
          if (!character) throw new CommandRejectedError("Whisper to one of the party's characters.");
          whisper = { characterId: character.id, name: character.name };
        }
      } else {
        const mine = claimedCharacterIds(state, principal.sessionId);
        if (mine.length === 0) throw new GameAccessDeniedError("Claim a character to talk at the table.");
        const speaking = request.actorId ?? (mine.length === 1 ? mine[0] : undefined);
        if (speaking === undefined) throw new CommandRejectedError("Say which of your characters is speaking.");
        if (!mine.includes(speaking)) throw new GameAccessDeniedError("You can only speak as your own character.");
        const character = state.actors.find((actor) => actor.id === speaking)!;
        author = { name: character.name, role: "player", actorId: character.id };
        if (request.whisperTo !== undefined && request.whisperTo !== "gm")
          throw new GameAccessDeniedError("Players whisper only to the GM.");
        if (request.whisperTo === "gm") whisper = { characterId: character.id, name: character.name };
      }

      if (!kit.context.chat.allow(sessionId, gm))
        throw new CommandRejectedError("That's a lot of lines at once. Wait a few seconds and send it again.");
      const row = kit.context.chat.post({
        commandId: request.commandId,
        text,
        author,
        ...(whisper ? { whisper } : {}),
        sessionId
      });
      return { entryId: idFor(row.entry.id) };
    }
  }),

  defineCommand({
    type: "chat.delete",
    operationId: "deleteChat",
    description:
      "Removes a chat line for everyone who could read it: a player may remove a line said as a character they play, and the GM any line. `entryId` is the line's id as the caller's feed holds it. Nothing of the line is kept; readers are sent `log:removed`. A line the caller can't read, or one already gone, is a 404-style refusal.",
    summary: "Remove a chat line: your own, or any line for the GM.",
    schema: ChatDeleteSchema,
    malformed: "The chat removal is malformed.",
    async run({ principal, request }, kit) {
      const gm = isGmGrade(principal);
      const row = kit.context.chat.find(request.entryId, gm);
      const gone = "That line is no longer in the log.";
      if (!row || row.entry.kind !== "chat") throw new CommandRejectedError(gone);
      if (!gm) {
        const mine = claimedCharacterIds(kit.read(), principal.sessionId);
        // A whisper to someone else is not this reader's to know of, so it reads as gone.
        if (row.entry.whisper && !mine.includes(row.entry.whisper.characterId)) throw new CommandRejectedError(gone);
        const own = row.entry.author?.role === "player" && mine.includes(row.entry.author.actorId ?? "");
        if (!own) throw new GameAccessDeniedError("You can remove only what your character said.");
      }
      kit.context.chat.remove(row);
      return { removed: true };
    }
  })
];
