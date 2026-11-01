import { useState } from "react";
import type { GmActor, GmView } from "@vtt/domain";
import { Button, EmptyState, Group, IconMore, IconPlus, Menu, MenuItem, useToast } from "@vtt/ui";
import { ActorAvatar } from "../actors/ActorAvatar";
import { useConfirm, usePrompt } from "../components/feedback";
import { command } from "../lib/command";
import { navigate } from "../router";
import { TokenLibrary } from "./TokenLibrary";
import "./tokens-page.css";

const KIND_WORDS: Readonly<Record<GmActor["kind"], string>> = {
  "player-character": "Character",
  npc: "Character the GM plays",
  monster: "Monster"
};

/**
 * Prep's Tokens page in groups (E2 spec 2.4, ADR-0063): Party, the GM's own groups, then Monsters; each creature with
 * its picture and a More to set its image or file it in a group. New group makes one; a group's More renames or deletes
 * it, and deleting returns its creatures to Party or Monsters. The groups are the GM's alone.
 */
export function TokensPage({ state, token }: Readonly<{ state: GmView; token: string }>) {
  const [choosing, setChoosing] = useState<GmActor | null>(null);
  const { prompt, dialog } = usePrompt();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toast } = useToast();
  const actors = state.actors.filter((actor) => !actor.archived).sort((a, b) => a.name.localeCompare(b.name));
  const groups = state.tokenGroups?.groups ?? [];
  const members = state.tokenGroups?.members ?? {};
  const groupOf = (actor: GmActor) =>
    groups.some((group) => group.id === members[actor.id]) ? members[actor.id] : null;
  const picture = (actor: GmActor) => (actor.tokenAssetId ? "Its own image" : "Default picture");
  const run = (event: Parameters<typeof command>[0], payload: Record<string, unknown>, failure: string) =>
    void command(event, payload as never).then((result) => {
      if (!result.ok) toast(result.message ?? failure, { tone: "error" });
    });
  const newGroup = async () => {
    const name = await prompt({ title: "New group", placeholder: "Group name", confirmLabel: "Make the group" });
    if (name?.trim()) run("token-group:create", { name: name.trim() }, "The group could not be made.");
  };
  const renameGroup = async (groupId: string, current: string) => {
    const name = await prompt({ title: "Rename group", defaultValue: current, confirmLabel: "Rename" });
    if (name?.trim() && name.trim() !== current)
      run("token-group:rename", { groupId, name: name.trim() }, "The group could not be renamed.");
  };
  const deleteGroup = async (groupId: string, name: string) => {
    if (
      await confirm({
        title: `Delete ${name}?`,
        body: "Its tokens go back to Party or Monsters.",
        confirmLabel: "Delete",
        danger: true
      })
    )
      run("token-group:delete", { groupId }, "The group could not be deleted.");
  };
  const fileIn = (actor: GmActor, groupId: string | null) =>
    run("actor:set-token-group", { actorId: actor.id, groupId }, "The creature could not be moved.");

  const sections: ReadonlyArray<
    Readonly<{ id: string; title: string; actors: GmActor[]; group?: { id: string; name: string } }>
  > = [
    {
      id: "party",
      title: "Party",
      actors: actors.filter((actor) => !groupOf(actor) && actor.kind === "player-character")
    },
    ...groups.map((group) => ({
      id: group.id,
      title: group.name,
      group,
      actors: actors.filter((actor) => groupOf(actor) === group.id)
    })),
    {
      id: "monsters",
      title: "Monsters",
      actors: actors.filter((actor) => !groupOf(actor) && actor.kind !== "player-character")
    }
  ];

  const rowMore = (actor: GmActor) => (
    <Menu trigger={<IconMore />} icon align="end" label={`More for ${actor.name}`}>
      <MenuItem onClick={() => setChoosing(actor)}>Set token image…</MenuItem>
      {groups
        .filter((group) => group.id !== groupOf(actor))
        .map((group) => (
          <MenuItem key={group.id} onClick={() => fileIn(actor, group.id)}>
            Move to {group.name}
          </MenuItem>
        ))}
      {groupOf(actor) && <MenuItem onClick={() => fileIn(actor, null)}>Take out of its group</MenuItem>}
    </Menu>
  );

  return (
    <section className="tokens-page frame-col" aria-labelledby="tokens-page-title">
      <h1 id="tokens-page-title" className="nh-sr-only">
        Tokens
      </h1>
      <div className="tokens-page-tool">
        <span className="tokens-page-count">
          {actors.length} {actors.length === 1 ? "creature" : "creatures"}
        </span>
        <Button size="sm" onClick={() => void newGroup()}>
          <IconPlus /> New group
        </Button>
      </div>
      <div className="scroll-y frame-fill tokens-page-body">
        {actors.length === 0 ? (
          <EmptyState action={<Button onClick={() => void navigate("/roster")}>Open Party</Button>}>
            No characters or monsters yet.
          </EmptyState>
        ) : (
          sections
            .filter((section) => section.group || section.actors.length > 0)
            .map((section) => (
              <Group
                key={section.id}
                kind="read"
                title={`${section.title} · ${section.actors.length}`}
                headingLevel={2}
                className="tokens-page-group"
                actions={
                  section.group ? (
                    <Menu trigger={<IconMore />} icon align="end" label={`More for ${section.group.name}`}>
                      <MenuItem onClick={() => void renameGroup(section.group!.id, section.group!.name)}>
                        Rename
                      </MenuItem>
                      <MenuItem tone="danger" onClick={() => void deleteGroup(section.group!.id, section.group!.name)}>
                        Delete the group
                      </MenuItem>
                    </Menu>
                  ) : undefined
                }
              >
                {section.actors.length === 0 ? (
                  <p className="tokens-page-none">Nothing in this group yet. Move a token here from its More.</p>
                ) : (
                  <ul className="tokens-page-rows" aria-label={section.title}>
                    {section.actors.map((actor) => (
                      <li key={actor.id} className="tokens-page-item">
                        <button
                          type="button"
                          className="tokens-page-row interactive"
                          onClick={() => setChoosing(actor)}
                        >
                          <ActorAvatar actor={actor} token={token} definitions={state.definitions} name={actor.name} />
                          <span className="tokens-page-row-text">
                            <b>{actor.name}</b>
                            <span>
                              {KIND_WORDS[actor.kind]} · {picture(actor)}
                            </span>
                          </span>
                        </button>
                        {rowMore(actor)}
                      </li>
                    ))}
                  </ul>
                )}
              </Group>
            ))
        )}
      </div>
      {choosing && (
        <TokenLibrary
          actorId={choosing.id}
          actorName={choosing.name}
          definitionId={choosing.definitionId ?? null}
          currentAssetId={choosing.tokenAssetId ?? null}
          token={token}
          role="gm"
          onClose={() => setChoosing(null)}
        />
      )}
      {dialog}
      {confirmDialog}
    </section>
  );
}
